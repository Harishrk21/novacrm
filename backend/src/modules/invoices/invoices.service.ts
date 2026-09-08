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

  // Pre-check stock for tracked products
  for (const line of d.lines as Array<{ productId?: string; quantity: number; description?: string }>) {
    if (!line.productId) continue;
    const product = productMap[line.productId];
    if (!product?.trackInventory) continue;
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
    await tx.numberSequence.update({
      where: { tenantId_sequenceKey: { tenantId: t, sequenceKey: "INVOICE" } },
      data: { nextValue: { increment: 1 } },
    });
    const invoiceNumber = `${seq.prefix}${String(seq.nextValue).padStart(seq.padding, "0")}`;

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
        description: x.description,
        quantity: x.quantity,
        unitPrice: x.unitPrice,
        taxPercent: x.taxPercent,
        lineTotal: base.add(tax),
      };
    });

    const discount = new Prisma.Decimal(d.discountTotal ?? 0);
    const invoiceId = newId();
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
        customFields: d.customFields,
        createdById: user,
      },
    });

    await tx.invoiceLine.createMany({
      data: lines.map((x: any) => ({ ...x, invoiceId })),
    });

    // Deduct inventory for tracked goods
    if (warehouse) {
      for (const line of lines) {
        if (!line.productId) continue;
        const product = productMap[line.productId];
        if (!product?.trackInventory) continue;

        const current = await tx.stockLevel.findUnique({
          where: {
            tenantId_productId_warehouseId: {
              tenantId: t,
              productId: line.productId,
              warehouseId: warehouse.id,
            },
          },
        });
        const qty = new Prisma.Decimal(line.quantity);
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
    }

    return {
      ...invoice,
      balanceDue: invoice.grandTotal,
      lines: await tx.invoiceLine.findMany({ where: { tenantId: t, invoiceId } }),
    };
  });

  if (d.serviceTicketId) {
    const svc = await prisma.ticket.findFirst({
      where: { id: String(d.serviceTicketId), tenantId: t, deletedAt: null },
    });
    if (!svc) throw notFound("Service ticket");
    const { assertCanInvoice } = await import("../tickets/ticketLifecycle.js");
    assertCanInvoice({
      status: svc.status,
      paymentTotal: Number(svc.paymentTotal),
      advanceAmount: Number(svc.advanceAmount),
    });
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
