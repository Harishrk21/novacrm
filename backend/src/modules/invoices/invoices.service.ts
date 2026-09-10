import { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.js";
import { newId } from "../../common/utils/id.js";
import { pagination, pageResult } from "../../common/utils/pagination.js";
import { AppError, notFound } from "../../common/errors.js";

export async function list(t: string, q: any) {
  const p = pagination(q);
  const where: any = { tenantId: t, deletedAt: null };
  if (q.status) where.status = q.status;
  if (q.accountId) where.accountId = q.accountId;
  if (q.contactId) where.contactId = String(q.contactId);
  if (q.serviceTicketId) where.serviceTicketId = String(q.serviceTicketId);
  const [items, total] = await Promise.all([
    prisma.invoice.findMany({
      where,
      skip: p.skip,
      take: p.take,
      orderBy: { invoiceDate: "desc" },
    }),
    prisma.invoice.count({ where }),
  ]);
  return pageResult(
    items.map((x) => ({ ...x, balanceDue: x.grandTotal.sub(x.amountPaid) })),
    total,
    p.page,
    p.limit,
  );
}

export async function get(t: string, id: string) {
  const invoice = await prisma.invoice.findFirst({
    where: { id, tenantId: t, deletedAt: null },
  });
  if (!invoice) throw notFound("Invoice");
  const lines = await prisma.invoiceLine.findMany({
    where: { tenantId: t, invoiceId: id },
  });
  return {
    ...invoice,
    balanceDue: invoice.grandTotal.sub(invoice.amountPaid),
    lines,
  };
}

/** Resolve a live account id — restore soft-deleted rows or heal from contact. */
async function resolveAccountForInvoice(
  t: string,
  accountId: string | null | undefined,
  contactId: string | null | undefined,
): Promise<string> {
  if (accountId) {
    const live = await prisma.account.findFirst({
      where: { id: accountId, tenantId: t, deletedAt: null },
    });
    if (live) return live.id;

    const soft = await prisma.account.findFirst({
      where: { id: accountId, tenantId: t, deletedAt: { not: null } },
    });
    if (soft) {
      await prisma.account.update({
        where: { id: soft.id },
        data: { deletedAt: null },
      });
      return soft.id;
    }
  }

  if (contactId) {
    const contact = await prisma.contact.findFirst({
      where: { id: contactId, tenantId: t, deletedAt: null },
    });
    if (!contact) throw notFound("Contact");

    if (contact.accountId) {
      const linkedLive = await prisma.account.findFirst({
        where: { id: contact.accountId, tenantId: t, deletedAt: null },
      });
      if (linkedLive) return linkedLive.id;

      const linkedSoft = await prisma.account.findFirst({
        where: { id: contact.accountId, tenantId: t, deletedAt: { not: null } },
      });
      if (linkedSoft) {
        await prisma.account.update({
          where: { id: linkedSoft.id },
          data: { deletedAt: null },
        });
        return linkedSoft.id;
      }
    }

    const newAccountId = newId();
    await prisma.account.create({
      data: {
        id: newAccountId,
        tenantId: t,
        name: contact.name,
        phone: contact.phone,
        email: contact.email,
        city: contact.city,
        state: contact.state,
        accountType: "CUSTOMER",
        customFields: { autoFromContact: contact.id },
      },
    });
    await prisma.contact.updateMany({
      where: { id: contact.id, tenantId: t },
      data: { accountId: newAccountId },
    });
    return newAccountId;
  }

  throw notFound("Account");
}

export async function create(t: string, user: string, d: any) {
  const accountId = await resolveAccountForInvoice(t, d.accountId, d.contactId);
  d.accountId = accountId;
  if (
    d.contactId &&
    !(await prisma.contact.findFirst({
      where: { id: d.contactId, tenantId: t, deletedAt: null },
    }))
  ) {
    throw notFound("Contact");
  }
  if (
    d.salesOrderId &&
    !(await prisma.salesOrder.findFirst({
      where: { id: d.salesOrderId, tenantId: t, deletedAt: null },
    }))
  ) {
    throw notFound("Sales order");
  }

  const productIds = d.lines.map((x: any) => x.productId).filter(Boolean) as string[];
  const products = productIds.length
    ? await prisma.product.findMany({
        where: { id: { in: productIds }, tenantId: t, deletedAt: null },
      })
    : [];
  if (productIds.length && products.length !== new Set(productIds).size) {
    throw new AppError("One or more products are invalid", 422);
  }
  const productMap = Object.fromEntries(products.map((p) => [p.id, p]));

  const warehouse =
    (await prisma.warehouse.findFirst({
      where: { tenantId: t, deletedAt: null, isActive: true, isDefault: true },
    })) ??
    (await prisma.warehouse.findFirst({
      where: { tenantId: t, deletedAt: null, isActive: true },
    }));

  // Pre-check stock for tracked products (serial lines validate unit availability instead)
  for (const line of d.lines as Array<{
    productId?: string;
    quantity: number;
    stockUnitId?: string | null;
  }>) {
    if (!line.productId) continue;
    const product = productMap[line.productId];
    if (!product?.trackInventory) continue;

    if (line.stockUnitId) {
      const unit = await prisma.stockUnit.findFirst({
        where: { id: String(line.stockUnitId), tenantId: t, deletedAt: null },
      });
      if (!unit) throw new AppError("Selected stock serial was not found", 404);
      if (unit.status !== "IN_STOCK" && unit.status !== "DEMO") {
        throw new AppError(`Serial ${unit.serialNo} is not available (${unit.status})`, 409);
      }
      if (unit.productId !== line.productId) {
        throw new AppError(`Serial ${unit.serialNo} does not match the selected product`, 400);
      }
      if (Number(line.quantity) !== 1) {
        throw new AppError(`Serial ${unit.serialNo} must be sold as quantity 1`, 400);
      }
      continue;
    }

    if (!warehouse) {
      throw new AppError(`No warehouse configured to deduct stock for ${product.name}`, 400);
    }
    const level = await prisma.stockLevel.findUnique({
      where: {
        tenantId_productId_warehouseId: {
          tenantId: t,
          productId: product.id,
          warehouseId: warehouse.id,
        },
      },
    });
    const onHand = Number(level?.quantityOnHand ?? 0);
    const reserved = Number(level?.quantityReserved ?? 0);
    const available = onHand - reserved;
    if (available < Number(line.quantity)) {
      throw new AppError(
        `Insufficient stock for ${product.name} (need ${line.quantity}, available ${available})`,
        409,
      );
    }
  }

  // Block duplicate service invoices before allocating a number / writing rows
  if (d.serviceTicketId) {
    const svc = await prisma.ticket.findFirst({
      where: { id: String(d.serviceTicketId), tenantId: t, deletedAt: null },
    });
    if (!svc) throw notFound("Service ticket");
    const existingInv =
      (svc.serviceInvoiceId
        ? await prisma.invoice.findFirst({
            where: { id: svc.serviceInvoiceId, tenantId: t, deletedAt: null },
          })
        : null) ??
      (await prisma.invoice.findFirst({
        where: {
          tenantId: t,
          deletedAt: null,
          serviceTicketId: String(d.serviceTicketId),
        },
        orderBy: { createdAt: "desc" },
      }));
    if (existingInv) {
      throw new AppError("Service invoice already exists for this ticket", 409, {
        invoiceId: existingInv.id,
        invoiceNumber: existingInv.invoiceNumber,
      });
    }
    const { assertCanInvoice } = await import("../tickets/ticketLifecycle.js");
    assertCanInvoice({
      status: svc.status,
      paymentTotal: Number(svc.paymentTotal),
      advanceAmount: Number(svc.advanceAmount),
    });
  }

  const created = await prisma.$transaction(async (tx) => {
    let seq = await tx.numberSequence.findUnique({
      where: { tenantId_sequenceKey: { tenantId: t, sequenceKey: "INVOICE" } },
    });
    if (!seq) {
      seq = await tx.numberSequence.create({
        data: {
          tenantId: t,
          sequenceKey: "INVOICE",
          prefix: "INV-",
          nextValue: 1,
          padding: 5,
        },
      });
    }

    // Atomic allocate — avoid read/increment races that reuse INV-xxxxx
    const allocated = await tx.numberSequence.update({
      where: { tenantId_sequenceKey: { tenantId: t, sequenceKey: "INVOICE" } },
      data: { nextValue: { increment: 1 } },
    });
    let nextNum = allocated.nextValue - 1;
    let invoiceNumber = `${allocated.prefix}${String(nextNum).padStart(allocated.padding, "0")}`;

    // If sequence drifted behind existing rows, jump past the highest INV-##### 
    for (let attempt = 0; attempt < 25; attempt++) {
      const clash = await tx.invoice.findFirst({
        where: { tenantId: t, invoiceNumber },
        select: { id: true },
      });
      if (!clash) break;
      const bumped = await tx.numberSequence.update({
        where: { tenantId_sequenceKey: { tenantId: t, sequenceKey: "INVOICE" } },
        data: { nextValue: { increment: 1 } },
      });
      nextNum = bumped.nextValue - 1;
      invoiceNumber = `${bumped.prefix}${String(nextNum).padStart(bumped.padding, "0")}`;
    }

    let subtotal = new Prisma.Decimal(0);
    let taxTotal = new Prisma.Decimal(0);
    const lines = d.lines.map((x: any) => {
      const base = new Prisma.Decimal(x.quantity).mul(x.unitPrice);
      const tax = base.mul(x.taxPercent).div(100);
      subtotal = subtotal.add(base);
      taxTotal = taxTotal.add(tax);
      return {
        id: newId(),
        tenantId: t,
        invoiceId: "",
        productId: x.productId,
        stockUnitId: x.stockUnitId ? String(x.stockUnitId) : null,
        description: x.description,
        quantity: x.quantity,
        unitPrice: x.unitPrice,
        taxPercent: x.taxPercent,
        lineTotal: base.add(tax),
      };
    });

    const discount = new Prisma.Decimal(d.discountTotal ?? 0);
    const invoiceId = newId();
    const serialBindings: Array<{ lineId: string; stockUnitId: string; serialNo: string }> = [];

    // Validate serials before writing invoice (serial sale lines must be qty 1 + IN_STOCK)
    for (const line of lines) {
      if (!line.stockUnitId) continue;
      const unit = await tx.stockUnit.findFirst({
        where: { id: line.stockUnitId, tenantId: t, deletedAt: null },
      });
      if (!unit) throw new AppError("Selected stock serial was not found", 404);
      if (unit.status !== "IN_STOCK" && unit.status !== "DEMO") {
        throw new AppError(`Serial ${unit.serialNo} is not available (${unit.status})`, 409);
      }
      if (line.productId && unit.productId !== line.productId) {
        throw new AppError(`Serial ${unit.serialNo} does not match the selected product`, 400);
      }
      if (Number(line.quantity) !== 1) {
        throw new AppError(`Serial ${unit.serialNo} must be sold as quantity 1`, 400);
      }
      if (!line.productId) line.productId = unit.productId;
    }

    const prevCustom =
      d.customFields && typeof d.customFields === "object" && !Array.isArray(d.customFields)
        ? (d.customFields as Record<string, unknown>)
        : {};
    const invoiceCustomFields = prevCustom as Prisma.InputJsonValue;

    const invoice = await tx.invoice.create({
      data: {
        id: invoiceId,
        tenantId: t,
        invoiceNumber,
        accountId: d.accountId,
        contactId: d.contactId,
        salesOrderId: d.salesOrderId,
        serviceTicketId: d.serviceTicketId ?? null,
        invoiceDate: d.invoiceDate,
        dueDate: d.dueDate,
        currency: d.currency ?? "INR",
        subtotal,
        taxTotal,
        discountTotal: discount,
        grandTotal: subtotal.add(taxTotal).sub(discount),
        notes: d.notes,
        customFields: invoiceCustomFields,
        createdById: user,
      },
    });

    await tx.invoiceLine.createMany({
      data: lines.map((x: any) => ({
        id: x.id,
        tenantId: x.tenantId,
        invoiceId,
        productId: x.productId,
        description: x.description,
        quantity: x.quantity,
        unitPrice: x.unitPrice,
        taxPercent: x.taxPercent,
        lineTotal: x.lineTotal,
      })),
    });

    // Deduct inventory for tracked goods + mark selected serials SOLD
    if (warehouse) {
      for (const line of lines) {
        if (!line.productId) continue;
        const product = productMap[line.productId];
        if (!product?.trackInventory) continue;

        const qty = new Prisma.Decimal(line.quantity);

        if (line.stockUnitId) {
          const unit = await tx.stockUnit.findFirst({
            where: { id: line.stockUnitId, tenantId: t, deletedAt: null },
          });
          if (!unit) throw new AppError("Selected stock serial was not found", 404);
          const unitCf =
            unit.customFields && typeof unit.customFields === "object" && !Array.isArray(unit.customFields)
              ? (unit.customFields as Record<string, unknown>)
              : {};
          await tx.stockUnit.update({
            where: { id: unit.id },
            data: {
              status: "SOLD",
              leadId: null,
              contactId: d.contactId ? String(d.contactId) : unit.contactId,
              customFields: {
                ...unitCf,
                soldAt: new Date().toISOString(),
                soldInvoiceId: invoiceId,
                soldInvoiceNumber: invoiceNumber,
              } as Prisma.InputJsonValue,
            },
          });
          serialBindings.push({
            lineId: line.id,
            stockUnitId: unit.id,
            serialNo: unit.serialNo,
          });

          // Prefer decrement on the unit's warehouse so counts stay honest
          const unitWh = unit.warehouseId || warehouse.id;
          const current = await tx.stockLevel.findUnique({
            where: {
              tenantId_productId_warehouseId: {
                tenantId: t,
                productId: line.productId,
                warehouseId: unitWh,
              },
            },
          });
          const next = (current?.quantityOnHand ?? new Prisma.Decimal(0)).sub(qty);
          if (next.isNegative()) {
            throw new AppError(`Insufficient stock for ${product.name}`, 409);
          }
          await tx.stockLevel.upsert({
            where: {
              tenantId_productId_warehouseId: {
                tenantId: t,
                productId: line.productId,
                warehouseId: unitWh,
              },
            },
            create: {
              id: newId(),
              tenantId: t,
              productId: line.productId,
              warehouseId: unitWh,
              quantityOnHand: next,
            },
            update: { quantityOnHand: next },
          });
          await tx.stockMovement.create({
            data: {
              id: newId(),
              tenantId: t,
              productId: line.productId,
              warehouseId: unitWh,
              movementType: "OUT",
              quantity: qty,
              notes: `Sale · ${invoiceNumber} · ${unit.serialNo}`,
              referenceType: "INVOICE",
              referenceId: invoiceId,
              performedBy: user,
            },
          });
          continue;
        }

        const current = await tx.stockLevel.findUnique({
          where: {
            tenantId_productId_warehouseId: {
              tenantId: t,
              productId: line.productId,
              warehouseId: warehouse.id,
            },
          },
        });
        const next = (current?.quantityOnHand ?? new Prisma.Decimal(0)).sub(qty);
        if (next.isNegative()) {
          throw new AppError(`Insufficient stock for ${product.name}`, 409);
        }

        await tx.stockLevel.upsert({
          where: {
            tenantId_productId_warehouseId: {
              tenantId: t,
              productId: line.productId,
              warehouseId: warehouse.id,
            },
          },
          create: {
            id: newId(),
            tenantId: t,
            productId: line.productId,
            warehouseId: warehouse.id,
            quantityOnHand: next,
          },
          update: { quantityOnHand: next },
        });

        await tx.stockMovement.create({
          data: {
            id: newId(),
            tenantId: t,
            productId: line.productId,
            warehouseId: warehouse.id,
            movementType: "OUT",
            quantity: qty,
            notes: `Sale · ${invoiceNumber}`,
            referenceType: "INVOICE",
            referenceId: invoiceId,
            performedBy: user,
          },
        });
      }
    } else {
      // Still mark serials sold even if MAIN warehouse row is missing
      for (const line of lines) {
        if (!line.stockUnitId) continue;
        const unit = await tx.stockUnit.findFirst({
          where: { id: line.stockUnitId, tenantId: t, deletedAt: null },
        });
        if (!unit) throw new AppError("Selected stock serial was not found", 404);
        const unitCf =
          unit.customFields && typeof unit.customFields === "object" && !Array.isArray(unit.customFields)
            ? (unit.customFields as Record<string, unknown>)
            : {};
        await tx.stockUnit.update({
          where: { id: unit.id },
          data: {
            status: "SOLD",
            leadId: null,
            contactId: d.contactId ? String(d.contactId) : unit.contactId,
            customFields: {
              ...unitCf,
              soldAt: new Date().toISOString(),
              soldInvoiceId: invoiceId,
              soldInvoiceNumber: invoiceNumber,
            } as Prisma.InputJsonValue,
          },
        });
        serialBindings.push({
          lineId: line.id,
          stockUnitId: unit.id,
          serialNo: unit.serialNo,
        });
      }
    }

    if (serialBindings.length) {
      await tx.invoice.update({
        where: { id: invoiceId },
        data: {
          customFields: {
            ...prevCustom,
            soldStockUnits: serialBindings,
          } as Prisma.InputJsonValue,
        },
      });
    }

    return {
      ...invoice,
      customFields: serialBindings.length
        ? { ...prevCustom, soldStockUnits: serialBindings }
        : invoice.customFields,
      balanceDue: invoice.grandTotal,
      lines: await tx.invoiceLine.findMany({ where: { tenantId: t, invoiceId } }),
    };
  });

  if (d.serviceTicketId) {
    await prisma.ticket.updateMany({
      where: { id: String(d.serviceTicketId), tenantId: t, deletedAt: null },
      data: { serviceInvoiceId: String(created.id) },
    });
  }

  let whatsapp: unknown = null;
  if (d.sendWhatsApp === true && d.contactId) {
    try {
      const { notifyProformaReady } = await import("../tickets/ticketNotify.service.js");
      const firstLine = (d.lines as Array<{ description?: string }>)?.[0];
      const productDescription =
        firstLine?.description ||
        (created.lines as Array<{ description?: string }> | undefined)?.[0]?.description ||
        "your order";
      whatsapp = await notifyProformaReady(
        t,
        {
          contactId: String(d.contactId),
          invoiceNumber: String(created.invoiceNumber),
          productDescription: String(productDescription),
          amount: Number(created.grandTotal),
        },
        user,
      );
    } catch (err) {
      console.error("proforma whatsapp failed", err);
    }
  }

  return { ...created, whatsapp };
}

export async function updateStatus(
  t: string,
  id: string,
  data: { status: string; amountPaid?: number },
) {
  const invoice = await prisma.invoice.findFirst({
    where: { id, tenantId: t, deletedAt: null },
  });
  if (!invoice) throw notFound("Invoice");
  if (invoice.status === "VOID") {
    throw new AppError("Void invoices cannot change status", 400);
  }

  const grand = Number(invoice.grandTotal);
  let amountPaid = Number(invoice.amountPaid);
  let status = data.status;

  if (status === "SENT") {
    // keep existing amountPaid (usually 0)
  } else if (status === "PAID") {
    amountPaid = grand;
  } else if (status === "PARTIAL") {
    const paid = data.amountPaid != null ? Number(data.amountPaid) : amountPaid;
    if (!(paid > 0) || paid >= grand) {
      throw new AppError("Partial payment must be greater than 0 and less than total", 400);
    }
    amountPaid = paid;
  } else if (status === "VOID") {
    // no payment change
  } else if (status === "DRAFT") {
    amountPaid = 0;
  } else if (status === "OVERDUE") {
    // keep amountPaid
  } else {
    throw new AppError(`Unsupported status ${status}`, 400);
  }

  // Auto-derive PARTIAL/PAID if amount set inconsistently
  if (status !== "VOID" && status !== "DRAFT") {
    if (amountPaid <= 0 && status === "PAID") amountPaid = grand;
    if (amountPaid >= grand) {
      status = "PAID";
      amountPaid = grand;
    } else if (amountPaid > 0 && amountPaid < grand && status === "SENT") {
      status = "PARTIAL";
    }
  }

  await prisma.invoice.update({
    where: { id },
    data: {
      status: status as any,
      amountPaid: new Prisma.Decimal(amountPaid),
    },
  });
  return get(t, id);
}
