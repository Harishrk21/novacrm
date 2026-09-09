import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { v4 as uuid } from "uuid";
import { env } from "../src/config/env.js";
import { flattenHmsMachines, HMS_CATALOG, buildHmsAttributes } from "./hmsCatalog.js";
const prisma = new PrismaClient();
const moduleGroup = (key:string) => key.startsWith("crm.") ? "CRM" as const : key.startsWith("erp.") ? "ERP" as const : "ENGAGEMENT" as const;
const categories=[
 {code:"WEIGHING_MACHINES",name:"Weighing Machines & Scales",description:"Dealers and manufacturers of industrial, retail and precision scales",icon:"scale",colorHex:"#0EA5E9",defaultModules:{"crm.leads":true,"crm.contacts":true,"crm.accounts":true,"crm.deals":true,"crm.activities":true,"crm.tickets":true,"erp.products":true,"erp.inventory":true,"erp.invoices":true},terminology:{lead:"Enquiry",deal:"Quotation",account:"Dealer",product:"Machine"},templateConfig:{pipeline:["Enquiry","Site Survey","Quotation","Negotiation","Won","Lost"],lead_sources:["Website","Dealer Referral","Exhibition","IndiaMART"]},sortOrder:1},
 {code:"RETAIL_COMMERCE",name:"Retail & Commerce",description:"Retailers and distributors",icon:"shopping-bag",colorHex:"#10B981",defaultModules:{"crm.leads":true,"crm.contacts":true,"crm.deals":true,"erp.products":true,"erp.inventory":true,"erp.invoices":true},terminology:{lead:"Lead",deal:"Opportunity",account:"Customer",product:"SKU"},templateConfig:{pipeline:["Prospect","Qualified","Proposal","Won","Lost"],lead_sources:["Walk-in","Website","Social","Referral"]},sortOrder:2}
];
const tips=[
 {id:"10000000-0000-4000-8000-000000000001",moduleKey:"crm.leads",sectionKey:"list",title:"How to use Leads",body:"Capture every enquiry here first, qualify it, then convert it to a contact, account and deal.",tipType:"TIP" as const,sortOrder:1},
 {id:"10000000-0000-4000-8000-000000000002",moduleKey:"crm.leads",sectionKey:"convert",title:"Convert wisely",body:"Only convert qualified leads and complete business-specific fields first.",tipType:"BEST_PRACTICE" as const,sortOrder:2},
 {id:"10000000-0000-4000-8000-000000000003",moduleKey:"crm.deals",sectionKey:"kanban",title:"Pipeline Kanban",body:"Move deals through stages and always record a reason when a deal is lost.",tipType:"TIP" as const,sortOrder:1},
 {id:"10000000-0000-4000-8000-000000000004",moduleKey:"erp.inventory",sectionKey:"list",title:"Stock discipline",body:"Every stock adjustment needs a reason so the movement ledger remains auditable.",tipType:"WARNING" as const,sortOrder:1},
 {id:"10000000-0000-4000-8000-000000000005",moduleKey:"erp.invoices",sectionKey:"create",title:"Invoicing tip",body:"Create invoices from confirmed orders whenever possible.",tipType:"TIP" as const,sortOrder:1}
];
async function main(){
 // Platform / super-admin is not used for this single-company HMS dashboard.
 // Keep a disabled row only so schema migrations remain happy if the table exists.
 const passwordHash=await bcrypt.hash(env.PLATFORM_ADMIN_PASSWORD,12);
 await prisma.platformAdmin.upsert({where:{email:env.PLATFORM_ADMIN_EMAIL},update:{passwordHash,status:"INACTIVE",deletedAt:null,name:"Disabled (HMS single-tenant)"},create:{id:uuid(),name:"Disabled (HMS single-tenant)",email:env.PLATFORM_ADMIN_EMAIL,passwordHash,role:"SUPER_ADMIN",status:"INACTIVE"}});
 if(await prisma.businessCategory.count({where:{deletedAt:null}})===0) await prisma.businessCategory.createMany({data:categories.map(c=>({id:uuid(),...c}))});
 for(const c of categories){await prisma.businessCategory.upsert({where:{code:c.code},update:{isActive:true,deletedAt:null},create:{id:uuid(),...c}})}
 const category=await prisma.businessCategory.findUniqueOrThrow({where:{code:"WEIGHING_MACHINES"}});
 const salesSettings={revenueTarget:500000,targetPeriod:"month",currency:"INR"};
 const tenant=await prisma.tenant.upsert({
  where:{slug:"precision-scales-india"},
  update:{
    name:"HMS Enterprises",
    code:"HMS01",
    email:"admin@hmsenterprises.in",
    phone:"+91 44 2435 0000",
    businessCategoryId:category.id,
    status:"ACTIVE",
    deletedAt:null,
    settings:salesSettings,
  },
  create:{
    id:uuid(),
    code:"HMS01",
    name:"HMS Enterprises",
    slug:"precision-scales-india",
    businessCategoryId:category.id,
    status:"ACTIVE",
    plan:"GROWTH",
    email:"admin@hmsenterprises.in",
    phone:"+91 44 2435 0000",
    modulesEnabled:category.defaultModules,
    terminology:category.terminology,
    settings:salesSettings,
    activatedAt:new Date(),
  },
 });
 const modules=category.defaultModules as Record<string,boolean>;
 for(const [moduleKey,isEnabled] of Object.entries(modules)){await prisma.tenantModule.upsert({where:{tenantId_moduleKey:{tenantId:tenant.id,moduleKey}},update:{isEnabled},create:{id:uuid(),tenantId:tenant.id,moduleKey,moduleGroup:moduleGroup(moduleKey),label:moduleKey.split(".").at(-1)!.replaceAll("_"," "),isEnabled}})}
 const role=await prisma.role.upsert({where:{tenantId_code:{tenantId:tenant.id,code:"ADMIN"}},update:{permissions:["*"]},create:{id:uuid(),tenantId:tenant.id,code:"ADMIN",name:"Administrator",isSystem:true,permissions:["*"]}});
 const userPassword=await bcrypt.hash("Demo@12345",12);

 /** Rename legacy Precision demo emails → HMS Enterprises. */
 async function migrateStaffEmail(from: string, to: string) {
  const modern = await prisma.user.findFirst({ where: { tenantId: tenant.id, email: to, deletedAt: null } });
  if (modern) return modern;
  const legacy = await prisma.user.findFirst({ where: { tenantId: tenant.id, email: from, deletedAt: null } });
  if (legacy) {
   return prisma.user.update({ where: { id: legacy.id }, data: { email: to } });
  }
  return null;
 }
 await migrateStaffEmail("demo@precisionscales.in", "admin@hmsenterprises.in");
 await migrateStaffEmail("desk@precisionscales.in", "desk@hmsenterprises.in");
 await migrateStaffEmail("engineer@precisionscales.in", "engineer@hmsenterprises.in");
 await migrateStaffEmail("warehouse@precisionscales.in", "warehouse@hmsenterprises.in");
 await migrateStaffEmail("sales@precisionscales.in", "sales@hmsenterprises.in");
 await migrateStaffEmail("karthik@precisionscales.in", "karthik@hmsenterprises.in");
 await migrateStaffEmail("priya@precisionscales.in", "priya@hmsenterprises.in");
 await migrateStaffEmail("arun@precisionscales.in", "arun@hmsenterprises.in");

 const user=await prisma.user.upsert({where:{tenantId_email:{tenantId:tenant.id,email:"admin@hmsenterprises.in"}},update:{passwordHash:userPassword,status:"ACTIVE",roleId:role.id,deletedAt:null,phone:"+91 94430 20000",name:"HMS Admin"},create:{id:uuid(),tenantId:tenant.id,roleId:role.id,name:"HMS Admin",email:"admin@hmsenterprises.in",phone:"+91 94430 20000",passwordHash:userPassword,status:"ACTIVE"}});
 const stageDefs=[{code:"ENQUIRY",name:"Enquiry",probability:10,colorHex:"#64748B"},{code:"SITE_SURVEY",name:"Site Survey",probability:30,colorHex:"#0EA5E9"},{code:"QUOTATION",name:"Quotation",probability:50,colorHex:"#2563EB"},{code:"NEGOTIATION",name:"Negotiation",probability:75,colorHex:"#F59E0B"},{code:"WON",name:"Won",probability:100,colorHex:"#10B981",isWon:true},{code:"LOST",name:"Lost",probability:0,colorHex:"#EF4444",isLost:true}];
 const stages=[];for(const [sortOrder,s]of stageDefs.entries()){stages.push(await prisma.pipelineStage.upsert({where:{tenantId_code:{tenantId:tenant.id,code:s.code}},update:{...s,sortOrder,isActive:true},create:{id:uuid(),tenantId:tenant.id,...s,sortOrder}}))}
 const sourceDefs=["Website","Dealer Referral","Exhibition","IndiaMART"];const sources=[];for(const name of sourceDefs){const code=name.toUpperCase().replace(/[^A-Z0-9]+/g,"_");sources.push(await prisma.leadSource.upsert({where:{tenantId_code:{tenantId:tenant.id,code}},update:{name,isActive:true},create:{id:uuid(),tenantId:tenant.id,name,code}}))}
 const warehouse=await prisma.warehouse.upsert({where:{tenantId_code:{tenantId:tenant.id,code:"MAIN"}},update:{isActive:true,isDefault:true,deletedAt:null,name:"Main warehouse"},create:{id:uuid(),tenantId:tenant.id,code:"MAIN",name:"Main warehouse",isDefault:true}});
 for (const w of [
  { code: "STORE", name: "Store", isDefault: false },
  { code: "EXECUTIVE", name: "Executive", isDefault: false },
  { code: "STAMPING", name: "Stamping", isDefault: false },
 ] as const) {
  await prisma.warehouse.upsert({
    where: { tenantId_code: { tenantId: tenant.id, code: w.code } },
    update: { isActive: true, deletedAt: null, name: w.name },
    create: { id: uuid(), tenantId: tenant.id, code: w.code, name: w.name, isDefault: w.isDefault },
  });
 }
 const productCategoryByCode = new Map<string, { id: string }>();
 for (const family of HMS_CATALOG) {
  const fam =
    (await prisma.productCategory.findFirst({ where: { tenantId: tenant.id, code: family.code, deletedAt: null } })) ??
    (await prisma.productCategory.create({
      data: { id: uuid(), tenantId: tenant.id, code: family.code, name: family.name, parentId: null },
    }));
  if (fam.name !== family.name || fam.parentId) {
    await prisma.productCategory.update({
      where: { id: fam.id },
      data: { name: family.name, parentId: null, deletedAt: null },
    });
  }
  productCategoryByCode.set(family.code, fam);
  if (family.hasIndustry && family.industries) {
    for (const ind of family.industries) {
      const code = `${family.code}__${ind.code}`;
      const row =
        (await prisma.productCategory.findFirst({ where: { tenantId: tenant.id, code, deletedAt: null } })) ??
        (await prisma.productCategory.create({
          data: { id: uuid(), tenantId: tenant.id, code, name: ind.name, parentId: fam.id },
        }));
      await prisma.productCategory.update({
        where: { id: row.id },
        data: { name: ind.name, parentId: fam.id, deletedAt: null },
      });
      productCategoryByCode.set(code, row);
    }
  }
 }

 const flatMachines = flattenHmsMachines();
 const products = [];
 for (const row of flatMachines) {
  const catCode = row.industryCode ? `${row.familyCode}__${row.industryCode}` : row.familyCode;
  const category = productCategoryByCode.get(catCode) ?? productCategoryByCode.get(row.familyCode)!;
  const attrs = buildHmsAttributes({
    familyCode: row.familyCode,
    familyName: row.familyName,
    industryCode: row.industryCode,
    industryName: row.industryName,
    machineName: row.machine.name,
    catalogKind: row.machine.catalogKind,
    requiresStamping: row.machine.requiresStamping ?? false,
  });
  const product = await prisma.product.upsert({
    where: { tenantId_sku: { tenantId: tenant.id, sku: row.machine.sku } },
    update: {
      name: row.machine.name,
      categoryId: category.id,
      productType: row.machine.productType ?? "GOODS",
      trackInventory: row.machine.trackInventory ?? true,
      salePrice: row.machine.salePrice ?? 0,
      purchasePrice: row.machine.purchasePrice ?? 0,
      attributes: attrs,
      isActive: true,
      deletedAt: null,
    },
    create: {
      id: uuid(),
      tenantId: tenant.id,
      categoryId: category.id,
      sku: row.machine.sku,
      name: row.machine.name,
      productType: row.machine.productType ?? "GOODS",
      trackInventory: row.machine.trackInventory ?? true,
      unit: "NOS",
      taxPercent: 18,
      salePrice: row.machine.salePrice ?? 0,
      purchasePrice: row.machine.purchasePrice ?? 0,
      attributes: attrs,
    },
  });
  products.push(product);
  if (product.trackInventory) {
    // Ensure 2 available serial units per machine for demo / invoice picking
    const seedSerials = [`${row.machine.sku}-01`, `${row.machine.sku}-02`];
    for (const serialRaw of seedSerials) {
      const serialNo = serialRaw.toUpperCase();
      const existing = await prisma.stockUnit.findFirst({
        where: { tenantId: tenant.id, serialNo, deletedAt: null },
      });
      if (existing) {
        await prisma.stockUnit.update({
          where: { id: existing.id },
          data: {
            productId: product.id,
            warehouseId: warehouse.id,
            status: existing.status === "SOLD" ? existing.status : "IN_STOCK",
            deletedAt: null,
          },
        });
      } else {
        await prisma.stockUnit.create({
          data: {
            id: uuid(),
            tenantId: tenant.id,
            productId: product.id,
            warehouseId: warehouse.id,
            serialNo,
            status: "IN_STOCK",
            stampingDate: row.machine.requiresStamping
              ? new Date(Date.UTC(2025, 0, 15))
              : null,
            notes: "Seed stock",
          },
        });
      }
    }
    const inStockCount = await prisma.stockUnit.count({
      where: {
        tenantId: tenant.id,
        productId: product.id,
        warehouseId: warehouse.id,
        status: "IN_STOCK",
        deletedAt: null,
      },
    });
    await prisma.stockLevel.upsert({
      where: {
        tenantId_productId_warehouseId: {
          tenantId: tenant.id,
          productId: product.id,
          warehouseId: warehouse.id,
        },
      },
      update: { quantityOnHand: inStockCount },
      create: {
        id: uuid(),
        tenantId: tenant.id,
        productId: product.id,
        warehouseId: warehouse.id,
        quantityOnHand: inStockCount,
      },
    });
  }
 }
 // Soft-delete any leftover test / legacy products not in HMS catalog
 {
  const catalogSkus = new Set(flatMachines.map((r) => r.machine.sku));
  const extras = await prisma.product.findMany({
    where: { tenantId: tenant.id, deletedAt: null },
    select: { id: true, sku: true },
  });
  const extraIds = extras.filter((p) => !catalogSkus.has(p.sku)).map((p) => p.id);
  if (extraIds.length) {
    const now = new Date();
    await prisma.stockUnit.updateMany({
      where: { tenantId: tenant.id, productId: { in: extraIds }, deletedAt: null },
      data: { deletedAt: now },
    });
    await prisma.stockLevel.deleteMany({
      where: { tenantId: tenant.id, productId: { in: extraIds } },
    });
    await prisma.product.updateMany({
      where: { tenantId: tenant.id, id: { in: extraIds } },
      data: { deletedAt: now, isActive: false },
    });
  }
 }
 // Soft-delete legacy demo CRM (do not recreate). Seed must never wipe real customers.
 {
  const now = new Date();
  const demoAccountNames = [
    "Metro Retail Systems",
    "Chennai Port Logistics",
    "Madurai Agro Mart",
    "Tiruppur Knit Exports",
    "Salem Steel Works",
    "Trichy Medical Stores",
  ];
  const demoContactEmails = [
    "rajesh@metro.example",
    "vignesh@chennaiport.example",
    "senthil@maduraiagro.example",
    "anitha@tiruppurknit.example",
    "ganesh@salemsteel.example",
    "kavitha@trichymed.example",
  ];
  const demoLeadEmails = [
    "anita@factory.example",
    "lead0@tn.example",
    "lead1@tn.example",
    "lead2@tn.example",
    "lead3@tn.example",
    "lead4@tn.example",
    "extra0@tnleads.example",
    "extra1@tnleads.example",
    "extra2@tnleads.example",
  ];
  const demoDealIds = [
    "20000000-0000-4000-8000-000000000001",
    "20000000-0000-4000-8000-000000000002",
    "20000000-0000-4000-8000-000000000003",
    "20000000-0000-4000-8000-000000000004",
    "20000000-0000-4000-8000-000000000005",
    "20000000-0000-4000-8000-000000000006",
  ];
  const demoInvoiceIds = [
    "30000000-0000-4000-8000-000000000001",
    "30000000-0000-4000-8000-000000000002",
    "30000000-0000-4000-8000-000000000003",
    "30000000-0000-4000-8000-000000000004",
    "30000000-0000-4000-8000-000000000005",
  ];
  const demoTicketIds = [
    "40000000-0000-4000-8000-000000000001",
    "40000000-0000-4000-8000-000000000002",
    "40000000-0000-4000-8000-000000000003",
    "40000000-0000-4000-8000-000000000004",
    "40000000-0000-4000-8000-000000000005",
  ];
  await prisma.account.updateMany({
    where: { tenantId: tenant.id, name: { in: demoAccountNames }, deletedAt: null },
    data: { deletedAt: now },
  });
  await prisma.contact.updateMany({
    where: { tenantId: tenant.id, email: { in: demoContactEmails }, deletedAt: null },
    data: { deletedAt: now },
  });
  // Seed often left duplicate Ganesh rows without the demo email
  await prisma.contact.updateMany({
    where: {
      tenantId: tenant.id,
      deletedAt: null,
      name: "Ganesh Babu",
      OR: [{ email: { in: demoContactEmails } }, { customerCode: null, email: null }],
    },
    data: { deletedAt: now },
  });
  await prisma.lead.updateMany({
    where: { tenantId: tenant.id, email: { in: demoLeadEmails }, deletedAt: null },
    data: { deletedAt: now },
  });
  await prisma.deal.updateMany({
    where: { id: { in: demoDealIds }, deletedAt: null },
    data: { deletedAt: now },
  });
  await prisma.invoice.updateMany({
    where: { id: { in: demoInvoiceIds }, deletedAt: null },
    data: { deletedAt: now },
  });
  await prisma.ticket.updateMany({
    where: { id: { in: demoTicketIds }, deletedAt: null },
    data: { deletedAt: now },
  });
  await prisma.activity.updateMany({
    where: {
      tenantId: tenant.id,
      deletedAt: null,
      OR: [
        { title: { contains: "Follow-up call —" } },
        { title: { contains: "Site visit —" } },
        { title: { contains: "Quotation email —" } },
      ],
    },
    data: { deletedAt: now },
  });
  await prisma.vendor.updateMany({
    where: {
      tenantId: tenant.id,
      deletedAt: null,
      name: {
        in: [
          "SteelBase Components",
          "Coimbatore Loadcell Hub",
          "Chennai Steel Fabricators",
          "Madurai Display Electronics",
          "Salem Weigh Parts",
          "Tiruppur Pack Machines",
        ],
      },
    },
    data: { deletedAt: now },
  });

  // Restore billing accounts for live contacts that still point at soft-deleted accounts
  const liveContacts = await prisma.contact.findMany({
    where: { tenantId: tenant.id, deletedAt: null, accountId: { not: null } },
    select: { id: true, accountId: true },
  });
  for (const c of liveContacts) {
    if (!c.accountId) continue;
    await prisma.account.updateMany({
      where: { id: c.accountId, tenantId: tenant.id, deletedAt: { not: null } },
      data: { deletedAt: null },
    });
  }
 }

 // Role pack + demo logins for service workflow
 const deskRole=await prisma.role.upsert({where:{tenantId_code:{tenantId:tenant.id,code:"SERVICE_DESK"}},update:{permissions:["crm"],name:"Service Desk"},create:{id:uuid(),tenantId:tenant.id,code:"SERVICE_DESK",name:"Service Desk",isSystem:true,permissions:["crm"]}});
 const engineerRole=await prisma.role.upsert({where:{tenantId_code:{tenantId:tenant.id,code:"SERVICE_ENGINEER"}},update:{permissions:["crm"],name:"Service Engineer"},create:{id:uuid(),tenantId:tenant.id,code:"SERVICE_ENGINEER",name:"Service Engineer",isSystem:true,permissions:["crm"]}});
 const warehouseRole=await prisma.role.upsert({where:{tenantId_code:{tenantId:tenant.id,code:"WAREHOUSE"}},update:{permissions:["erp"],name:"Warehouse Team"},create:{id:uuid(),tenantId:tenant.id,code:"WAREHOUSE",name:"Warehouse Team",isSystem:true,permissions:["erp"]}});
 await prisma.user.upsert({where:{tenantId_email:{tenantId:tenant.id,email:"desk@hmsenterprises.in"}},update:{passwordHash:userPassword,status:"ACTIVE",roleId:deskRole.id,deletedAt:null,name:"Service Desk"},create:{id:uuid(),tenantId:tenant.id,roleId:deskRole.id,name:"Service Desk",email:"desk@hmsenterprises.in",phone:"+91 94430 20001",passwordHash:userPassword,status:"ACTIVE"}});
 await prisma.user.upsert({where:{tenantId_email:{tenantId:tenant.id,email:"engineer@hmsenterprises.in"}},update:{passwordHash:userPassword,status:"ACTIVE",roleId:engineerRole.id,deletedAt:null,name:"Field Engineer"},create:{id:uuid(),tenantId:tenant.id,roleId:engineerRole.id,name:"Field Engineer",email:"engineer@hmsenterprises.in",phone:"+91 94430 20002",passwordHash:userPassword,status:"ACTIVE"}});
 await prisma.user.upsert({where:{tenantId_email:{tenantId:tenant.id,email:"warehouse@hmsenterprises.in"}},update:{passwordHash:userPassword,status:"ACTIVE",roleId:warehouseRole.id,deletedAt:null,name:"Warehouse Staff"},create:{id:uuid(),tenantId:tenant.id,roleId:warehouseRole.id,name:"Warehouse Staff",email:"warehouse@hmsenterprises.in",phone:"+91 94430 20003",passwordHash:userPassword,status:"ACTIVE"}});

 const salesRole=await prisma.role.upsert({where:{tenantId_code:{tenantId:tenant.id,code:"SALES_EXECUTIVE"}},update:{permissions:["crm"],name:"Sales Executive"},create:{id:uuid(),tenantId:tenant.id,code:"SALES_EXECUTIVE",name:"Sales Executive",isSystem:true,permissions:["crm"]}});
 await prisma.user.upsert({where:{tenantId_email:{tenantId:tenant.id,email:"sales@hmsenterprises.in"}},update:{passwordHash:userPassword,status:"ACTIVE",roleId:salesRole.id,deletedAt:null,name:"Sales Executive"},create:{id:uuid(),tenantId:tenant.id,roleId:salesRole.id,name:"Sales Executive",email:"sales@hmsenterprises.in",phone:"+91 94430 20004",passwordHash:userPassword,status:"ACTIVE"}});

 // Agent / engineer users for assignment demos
 const agentRole=await prisma.role.upsert({where:{tenantId_code:{tenantId:tenant.id,code:"AGENT"}},update:{permissions:["crm"],name:"Sales Executive"},create:{id:uuid(),tenantId:tenant.id,code:"AGENT",name:"Sales Executive",isSystem:true,permissions:["crm"]}});
 const agentDefs=[
  {email:"karthik@hmsenterprises.in",name:"Karthik Rajan",phone:"+91 94430 11101", roleId: engineerRole.id},
  {email:"priya@hmsenterprises.in",name:"Priya Venkatesh",phone:"+91 94430 11102", roleId: engineerRole.id},
  {email:"arun@hmsenterprises.in",name:"Arun Selvaraj",phone:"+91 94430 11103", roleId: salesRole.id},
 ];
 const agents=[user];
 for(const a of agentDefs){
  agents.push(await prisma.user.upsert({
    where:{tenantId_email:{tenantId:tenant.id,email:a.email}},
    update:{passwordHash:userPassword,status:"ACTIVE",roleId:a.roleId,deletedAt:null,name:a.name,phone:a.phone},
    create:{id:uuid(),tenantId:tenant.id,roleId:a.roleId,name:a.name,email:a.email,phone:a.phone,passwordHash:userPassword,status:"ACTIVE"},
  }));
 }

 for(const sequenceKey of ["INVOICE","SO","PO","TICKET","DEMO_DC","PAYMENT"]){await prisma.numberSequence.upsert({where:{tenantId_sequenceKey:{tenantId:tenant.id,sequenceKey}},update:sequenceKey==="DEMO_DC"?{prefix:"DC-"}:sequenceKey==="INVOICE"?{prefix:"PI-",nextValue:10}:sequenceKey==="PAYMENT"?{prefix:"PAY-"}:sequenceKey==="TICKET"?{prefix:"SVC-",nextValue:10}:{nextValue:10},create:{tenantId:tenant.id,sequenceKey,prefix:sequenceKey==="DEMO_DC"?"DC-":sequenceKey==="INVOICE"?"PI-":sequenceKey==="PAYMENT"?"PAY-":sequenceKey==="TICKET"?"SVC-":`${sequenceKey}-`,nextValue:sequenceKey==="DEMO_DC"?1:10,padding:5}})}
 for(const tip of tips){await prisma.featureTip.upsert({where:{id:tip.id},update:{...tip,isActive:true},create:{...tip,tenantId:null}})}

 // Employee profiles for every demo login (editable anytime under Users & Roles)
 {
  const roleRows = await prisma.role.findMany({ where: { tenantId: tenant.id, deletedAt: null } });
  const roleCodeById = Object.fromEntries(roleRows.map((r) => [r.id, r.code]));
  const deptByRole: Record<string, { department: string; designation: string }> = {
    ADMIN: { department: "Management", designation: "Company Admin" },
    MANAGER: { department: "Management", designation: "Manager" },
    SERVICE_DESK: { department: "Service", designation: "Service Desk" },
    SERVICE_ENGINEER: { department: "Service", designation: "Field Engineer" },
    SALES_EXECUTIVE: { department: "Sales", designation: "Sales Executive" },
    AGENT: { department: "Sales", designation: "Sales Executive" },
    WAREHOUSE: { department: "Warehouse", designation: "Warehouse & billing" },
  };
  const allUsers = await prisma.user.findMany({
    where: { tenantId: tenant.id, deletedAt: null },
    orderBy: { createdAt: "asc" },
  });
  let empSeq = 1;
  for (const u of allUsers) {
    const code = roleCodeById[u.roleId] ?? "STAFF";
    const meta = deptByRole[code] ?? { department: "General", designation: "Staff" };
    const phone = u.phone?.trim() || `+91 94430 ${String(20000 + empSeq).slice(-5)}`;
    if (!u.phone?.trim()) {
      await prisma.user.update({ where: { id: u.id }, data: { phone } });
    }
    const existingEmp = await prisma.employee.findFirst({
      where: { tenantId: tenant.id, userId: u.id, deletedAt: null },
    });
    if (existingEmp) {
      await prisma.employee.update({
        where: { id: existingEmp.id },
        data: {
          name: u.name,
          email: u.email,
          phone: u.phone?.trim() || phone,
          department: existingEmp.department || meta.department,
          designation: existingEmp.designation || meta.designation,
          status: "ACTIVE",
          deletedAt: null,
        },
      });
    } else {
      // Codes may still be reserved by soft-deleted employees — scan all rows
      let employeeCode = `EMP-${String(empSeq).padStart(3, "0")}`;
      while (
        await prisma.employee.findFirst({
          where: { tenantId: tenant.id, employeeCode },
        })
      ) {
        empSeq += 1;
        employeeCode = `EMP-${String(empSeq).padStart(3, "0")}`;
      }
      await prisma.employee.create({
        data: {
          id: uuid(),
          tenantId: tenant.id,
          userId: u.id,
          employeeCode,
          name: u.name,
          email: u.email,
          phone: u.phone?.trim() || phone,
          department: meta.department,
          designation: meta.designation,
          joinDate: new Date("2024-01-15"),
          status: "ACTIVE",
          customFields: {
            notes: "Demo employee — edit anytime in Users & Roles (mobile used for WhatsApp alerts).",
          },
        },
      });
    }
    empSeq += 1;
  }
 }

 console.log(`Seeded ${tenant.name}; admin@hmsenterprises.in / Demo@12345; desk@ / engineer@ / warehouse@ / sales@hmsenterprises.in; agents ${agents.length-1}; products ${products.length}; employees linked.`);

 // Small safe showcase CRM pack for demos (stable emails — never wipes real customers)
 {
  const { allocateCustomerIdentity } = await import("../src/modules/contacts/customerIdentity.js");
  const salesUser = await prisma.user.findFirst({
    where: { tenantId: tenant.id, email: "sales@hmsenterprises.in", deletedAt: null },
  });
  const engineerUser = await prisma.user.findFirst({
    where: { tenantId: tenant.id, email: "engineer@hmsenterprises.in", deletedAt: null },
  });
  const deskUser = await prisma.user.findFirst({
    where: { tenantId: tenant.id, email: "desk@hmsenterprises.in", deletedAt: null },
  });

  type ShowcaseContact = {
    email: string;
    name: string;
    phone: string;
    city: string;
    accountName: string;
  };
  const showcaseContacts: ShowcaseContact[] = [
    {
      email: "chellammal@hms-demo.example",
      name: "Chellammal Traders",
      phone: "919876501001",
      city: "Madurai",
      accountName: "Chellammal Traders",
    },
    {
      email: "preethu@hms-demo.example",
      name: "Preethu V",
      phone: "919876501002",
      city: "Coimbatore",
      accountName: "Preethu Retail",
    },
    {
      email: "anand@hms-demo.example",
      name: "Anand Engineering",
      phone: "919876501003",
      city: "Tiruppur",
      accountName: "Anand Engineering",
    },
  ];

  const contactByEmail: Record<string, { id: string; accountId: string }> = {};
  for (const row of showcaseContacts) {
    let account = await prisma.account.findFirst({
      where: { tenantId: tenant.id, name: row.accountName },
    });
    if (account) {
      account = await prisma.account.update({
        where: { id: account.id },
        data: {
          deletedAt: null,
          phone: row.phone,
          email: row.email,
          city: row.city,
          state: "Tamil Nadu",
          industry: "Weighing / retail",
        },
      });
    } else {
      account = await prisma.account.create({
        data: {
          id: uuid(),
          tenantId: tenant.id,
          name: row.accountName,
          phone: row.phone,
          email: row.email,
          city: row.city,
          state: "Tamil Nadu",
          country: "IN",
          industry: "Weighing / retail",
        },
      });
    }

    let contact = await prisma.contact.findFirst({
      where: { tenantId: tenant.id, email: row.email },
    });
    if (contact) {
      contact = await prisma.contact.update({
        where: { id: contact.id },
        data: {
          deletedAt: null,
          name: row.name,
          phone: row.phone,
          mobile: row.phone,
          phoneNormalized: row.phone,
          city: row.city,
          state: "Tamil Nadu",
          accountId: account.id,
          ownerUserId: deskUser?.id ?? user.id,
        },
      });
    } else {
      const identity = await allocateCustomerIdentity(tenant.id);
      contact = await prisma.contact.create({
        data: {
          id: uuid(),
          tenantId: tenant.id,
          customerNo: identity.customerNo,
          customerCode: identity.customerCode,
          accountId: account.id,
          name: row.name,
          email: row.email,
          phone: row.phone,
          mobile: row.phone,
          phoneNormalized: row.phone,
          city: row.city,
          state: "Tamil Nadu",
          country: "IN",
          ownerUserId: deskUser?.id ?? user.id,
          description: "Showcase demo customer — safe to use in client demos.",
          customFields: { demoPack: "hms-showcase" },
        },
      });
    }
    contactByEmail[row.email] = { id: contact.id, accountId: account.id };
  }

  const showcaseLeads = [
    {
      email: "enquiry.retail@hms-demo.example",
      name: "Lakshmi Super Market",
      phone: "919876501011",
      company: "Lakshmi Super Market",
      status: "NEW" as const,
      city: "Salem",
    },
    {
      email: "enquiry.factory@hms-demo.example",
      name: "Sri Krishna Mills",
      phone: "919876501012",
      company: "Sri Krishna Mills",
      status: "CONTACTED" as const,
      city: "Erode",
    },
  ];
  for (const lead of showcaseLeads) {
    const existing = await prisma.lead.findFirst({
      where: { tenantId: tenant.id, email: lead.email },
    });
    const payload = {
      deletedAt: null as Date | null,
      name: lead.name,
      phone: lead.phone,
      phoneNormalized: lead.phone,
      company: lead.company,
      city: lead.city,
      state: "Tamil Nadu",
      status: lead.status,
      assignedToId: salesUser?.id ?? user.id,
      createdById: salesUser?.id ?? user.id,
      description: "Showcase sale enquiry for demos.",
      customFields: { demoPack: "hms-showcase" },
    };
    if (existing) {
      await prisma.lead.update({ where: { id: existing.id }, data: payload });
    } else {
      await prisma.lead.create({
        data: {
          id: uuid(),
          tenantId: tenant.id,
          email: lead.email,
          country: "IN",
          ...payload,
        },
      });
    }
  }

  const ticketDefs = [
    {
      id: "a1000000-0000-4000-8000-000000000001",
      ticketNo: 18,
      subject: "Billing machine — display blank",
      description: "Customer reports blank display on billing machine after power cut. Showcase OPEN ticket awaiting assignment.",
      status: "OPEN" as const,
      contactEmail: "chellammal@hms-demo.example",
      assignedToId: null as string | null,
    },
    {
      id: "a1000000-0000-4000-8000-000000000002",
      ticketNo: 17,
      subject: "Platform scale — calibration drift",
      description: "Weighing scale drifts after warm-up. Showcase IN_PROGRESS ticket assigned to field engineer.",
      status: "IN_PROGRESS" as const,
      contactEmail: "preethu@hms-demo.example",
      assignedToId: engineerUser?.id ?? null,
    },
    {
      id: "a1000000-0000-4000-8000-000000000003",
      ticketNo: 16,
      subject: "Stamping due reminder — table top",
      description: "Annual stamping due. Showcase CLOSED ticket for reports.",
      status: "CLOSED" as const,
      contactEmail: "anand@hms-demo.example",
      assignedToId: engineerUser?.id ?? null,
    },
  ];

  let nextFreeTicket =
    (
      await prisma.ticket.aggregate({
        where: { tenantId: tenant.id },
        _max: { ticketNo: true },
      })
    )._max.ticketNo ?? 15;

  for (const td of ticketDefs) {
    const c = contactByEmail[td.contactEmail];
    if (!c) continue;
    const existing = await prisma.ticket.findFirst({ where: { id: td.id } });
    let ticketNo = existing?.ticketNo ?? td.ticketNo;
    if (!existing) {
      const clash = await prisma.ticket.findFirst({
        where: { tenantId: tenant.id, ticketNo, deletedAt: null },
      });
      if (clash) {
        nextFreeTicket += 1;
        ticketNo = nextFreeTicket;
      }
      nextFreeTicket = Math.max(nextFreeTicket, ticketNo);
    }

    const base = {
      tenantId: tenant.id,
      ticketNo,
      subject: td.subject,
      description: td.description,
      priority: "MEDIUM" as const,
      status: td.status,
      contactId: c.id,
      accountId: c.accountId,
      assignedToId: td.assignedToId,
      receivedByUserId: td.assignedToId,
      deletedAt: null as Date | null,
      closedAt: td.status === "CLOSED" ? new Date() : null,
      resolvedAt: td.status === "CLOSED" ? new Date() : null,
      customFields: { demoPack: "hms-showcase", machine: td.subject.split("—")[0]?.trim() },
    };
    if (existing) {
      await prisma.ticket.update({
        where: { id: td.id },
        data: { ...base, ticketNo: existing.ticketNo },
      });
    } else {
      await prisma.ticket.create({ data: { id: td.id, ...base } });
    }
  }

  // Keep SVC sequence ahead of showcase numbers
  const maxTicket = await prisma.ticket.aggregate({
    where: { tenantId: tenant.id },
    _max: { ticketNo: true },
  });
  const nextTicket = Math.max(20, (maxTicket._max.ticketNo ?? 0) + 1);
  await prisma.numberSequence.updateMany({
    where: { tenantId: tenant.id, sequenceKey: "TICKET" },
    data: { nextValue: nextTicket },
  });

  console.log(
    `Showcase CRM pack ready: ${showcaseContacts.length} customers, ${showcaseLeads.length} sale enquiries, ${ticketDefs.length} service tickets.`,
  );
 }
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>prisma.$disconnect());
