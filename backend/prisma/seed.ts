import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { v4 as uuid } from "uuid";
import { env } from "../src/config/env.js";
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
 const passwordHash=await bcrypt.hash(env.PLATFORM_ADMIN_PASSWORD,12);
 await prisma.platformAdmin.upsert({where:{email:env.PLATFORM_ADMIN_EMAIL},update:{passwordHash,status:"ACTIVE",deletedAt:null},create:{id:uuid(),name:"Nova Super Admin",email:env.PLATFORM_ADMIN_EMAIL,passwordHash,role:"SUPER_ADMIN",status:"ACTIVE"}});
 if(await prisma.businessCategory.count({where:{deletedAt:null}})===0) await prisma.businessCategory.createMany({data:categories.map(c=>({id:uuid(),...c}))});
 for(const c of categories){await prisma.businessCategory.upsert({where:{code:c.code},update:{isActive:true,deletedAt:null},create:{id:uuid(),...c}})}
 const category=await prisma.businessCategory.findUniqueOrThrow({where:{code:"WEIGHING_MACHINES"}});
 const salesSettings={revenueTarget:500000,targetPeriod:"month",currency:"INR"};
 const tenant=await prisma.tenant.upsert({where:{slug:"precision-scales-india"},update:{businessCategoryId:category.id,status:"ACTIVE",deletedAt:null,settings:salesSettings},create:{id:uuid(),code:"PSI01",name:"Precision Scales India",slug:"precision-scales-india",businessCategoryId:category.id,status:"ACTIVE",plan:"GROWTH",email:"demo@precisionscales.in",phone:"+91 98765 43210",modulesEnabled:category.defaultModules,terminology:category.terminology,settings:salesSettings,activatedAt:new Date()}});
 const modules=category.defaultModules as Record<string,boolean>;
 for(const [moduleKey,isEnabled] of Object.entries(modules)){await prisma.tenantModule.upsert({where:{tenantId_moduleKey:{tenantId:tenant.id,moduleKey}},update:{isEnabled},create:{id:uuid(),tenantId:tenant.id,moduleKey,moduleGroup:moduleGroup(moduleKey),label:moduleKey.split(".").at(-1)!.replaceAll("_"," "),isEnabled}})}
 const role=await prisma.role.upsert({where:{tenantId_code:{tenantId:tenant.id,code:"ADMIN"}},update:{permissions:["*"]},create:{id:uuid(),tenantId:tenant.id,code:"ADMIN",name:"Administrator",isSystem:true,permissions:["*"]}});
 const userPassword=await bcrypt.hash("Demo@12345",12);
 const user=await prisma.user.upsert({where:{tenantId_email:{tenantId:tenant.id,email:"demo@precisionscales.in"}},update:{passwordHash:userPassword,status:"ACTIVE",roleId:role.id,deletedAt:null},create:{id:uuid(),tenantId:tenant.id,roleId:role.id,name:"Precision Admin",email:"demo@precisionscales.in",passwordHash:userPassword,status:"ACTIVE"}});
 const stageDefs=[{code:"ENQUIRY",name:"Enquiry",probability:10,colorHex:"#64748B"},{code:"SITE_SURVEY",name:"Site Survey",probability:30,colorHex:"#0EA5E9"},{code:"QUOTATION",name:"Quotation",probability:50,colorHex:"#2563EB"},{code:"NEGOTIATION",name:"Negotiation",probability:75,colorHex:"#F59E0B"},{code:"WON",name:"Won",probability:100,colorHex:"#10B981",isWon:true},{code:"LOST",name:"Lost",probability:0,colorHex:"#EF4444",isLost:true}];
 const stages=[];for(const [sortOrder,s]of stageDefs.entries()){stages.push(await prisma.pipelineStage.upsert({where:{tenantId_code:{tenantId:tenant.id,code:s.code}},update:{...s,sortOrder,isActive:true},create:{id:uuid(),tenantId:tenant.id,...s,sortOrder}}))}
 const sourceDefs=["Website","Dealer Referral","Exhibition","IndiaMART"];const sources=[];for(const name of sourceDefs){const code=name.toUpperCase().replace(/[^A-Z0-9]+/g,"_");sources.push(await prisma.leadSource.upsert({where:{tenantId_code:{tenantId:tenant.id,code}},update:{name,isActive:true},create:{id:uuid(),tenantId:tenant.id,name,code}}))}
 const warehouse=await prisma.warehouse.upsert({where:{tenantId_code:{tenantId:tenant.id,code:"MAIN"}},update:{isActive:true,isDefault:true,deletedAt:null},create:{id:uuid(),tenantId:tenant.id,code:"MAIN",name:"Main Warehouse",isDefault:true}});
 const productCategory=await prisma.productCategory.findFirst({where:{tenantId:tenant.id,code:"SCALES",deletedAt:null}})??await prisma.productCategory.create({data:{id:uuid(),tenantId:tenant.id,code:"SCALES",name:"Weighing Scales"}});
 const productDefs=[
  {sku:"PS-300",name:"Platform Scale 300 kg",salePrice:18500,purchasePrice:12500,attributes:{capacity_kg:300,accuracy_g:50,platform_size:"600x600 mm"}},
  {sku:"TT-30",name:"Table Top Scale 30 kg",salePrice:6500,purchasePrice:4100,attributes:{capacity_kg:30,accuracy_g:2,display:"dual LED"}},
  {sku:"JS-500",name:"Jewellery Scale 500 g",salePrice:9500,purchasePrice:6200,attributes:{capacity_kg:0.5,accuracy_g:0.01}},
  {sku:"TS-50T",name:"Truck Scale 50 Ton",salePrice:285000,purchasePrice:195000,attributes:{capacity_kg:50000,accuracy_g:10000,type:"weighbridge"}},
  {sku:"CS-150",name:"Counting Scale 15 kg",salePrice:12500,purchasePrice:8200,attributes:{capacity_kg:15,accuracy_g:1,mode:"piece counting"}},
 ];
 const products=[];for(const d of productDefs){const product=await prisma.product.upsert({where:{tenantId_sku:{tenantId:tenant.id,sku:d.sku}},update:{...d,isActive:true,deletedAt:null},create:{id:uuid(),tenantId:tenant.id,categoryId:productCategory.id,...d,trackInventory:true,unit:"NOS",taxPercent:18}});products.push(product);await prisma.stockLevel.upsert({where:{tenantId_productId_warehouseId:{tenantId:tenant.id,productId:product.id,warehouseId:warehouse.id}},update:{quantityOnHand:25},create:{id:uuid(),tenantId:tenant.id,productId:product.id,warehouseId:warehouse.id,quantityOnHand:25}})}
 const account=await prisma.account.findFirst({where:{tenantId:tenant.id,name:"Metro Retail Systems",deletedAt:null}})??await prisma.account.create({data:{id:uuid(),tenantId:tenant.id,name:"Metro Retail Systems",accountType:"Customer",phone:"+919810001111",email:"purchase@metro.example",city:"Coimbatore",state:"Tamil Nadu",gstin:"33AABCM1234A1Z5",industry:"Retail"}});
 const vendor=await prisma.vendor.findFirst({where:{tenantId:tenant.id,name:"SteelBase Components",deletedAt:null}})??await prisma.vendor.create({data:{id:uuid(),tenantId:tenant.id,name:"SteelBase Components",phone:"+919900001111",email:"sales@steelbase.example",gstin:"33AABCS9999B1Z1",paymentTerms:"Net 30"}});
 void vendor;
 const contact=await prisma.contact.findFirst({where:{tenantId:tenant.id,email:"rajesh@metro.example",deletedAt:null}})??await prisma.contact.create({data:{id:uuid(),tenantId:tenant.id,accountId:account.id,name:"Rajesh Kumar",email:"rajesh@metro.example",phone:"+91 98100 01111",phoneNormalized:"919810001111",title:"Purchase Manager"}});
 const lead=await prisma.lead.findFirst({where:{tenantId:tenant.id,email:"anita@factory.example",deletedAt:null}})??await prisma.lead.create({data:{id:uuid(),tenantId:tenant.id,name:"Anita Sharma",email:"anita@factory.example",phone:"+91 98200 02222",phoneNormalized:"919820002222",company:"Sharma Engineering",sourceId:sources[0].id,status:"QUALIFIED",score:75,assignedToId:user.id,createdById:user.id,customFields:{machine_type:"Platform",capacity_kg:500}}});
 await prisma.deal.upsert({where:{id:"20000000-0000-4000-8000-000000000001"},update:{tenantId:tenant.id,stageId:stages[2].id,deletedAt:null},create:{id:"20000000-0000-4000-8000-000000000001",tenantId:tenant.id,name:"Metro Retail - Platform Scale",amount:42000,stageId:stages[2].id,probability:stages[2].probability,contactId:contact.id,accountId:account.id,ownerUserId:user.id}});

 // Agent users
 const agentRole=await prisma.role.upsert({where:{tenantId_code:{tenantId:tenant.id,code:"AGENT"}},update:{permissions:["crm","erp"]},create:{id:uuid(),tenantId:tenant.id,code:"AGENT",name:"Sales Agent",isSystem:true,permissions:["crm","erp"]}});
 const agentDefs=[
  {email:"karthik@precisionscales.in",name:"Karthik Rajan",phone:"+91 94430 11101"},
  {email:"priya@precisionscales.in",name:"Priya Venkatesh",phone:"+91 94430 11102"},
  {email:"arun@precisionscales.in",name:"Arun Selvaraj",phone:"+91 94430 11103"},
 ];
 const agents=[user];
 for(const a of agentDefs){
  agents.push(await prisma.user.upsert({
    where:{tenantId_email:{tenantId:tenant.id,email:a.email}},
    update:{passwordHash:userPassword,status:"ACTIVE",roleId:agentRole.id,deletedAt:null,name:a.name,phone:a.phone},
    create:{id:uuid(),tenantId:tenant.id,roleId:agentRole.id,name:a.name,email:a.email,phone:a.phone,passwordHash:userPassword,status:"ACTIVE"},
  }));
 }

 // Tamil Nadu customer pack (5 companies across TN cities)
 const tnPack=[
  {account:"Chennai Port Logistics",city:"Chennai",industry:"Logistics",contact:"Vignesh Murali",email:"vignesh@chennaiport.example",phone:"+91 98400 10001",gstin:"33AABCP1001A1Z1",lead:"Meena Krishnan",leadCo:"Harbour Traders",leadStatus:"NEW" as const,score:55,source:0,deal:"Chennai Port - Truck Scale",amount:185000,stage:0,owner:1,won:false,daysAgo:3},
  {account:"Madurai Agro Mart",city:"Madurai",industry:"Agriculture",contact:"Senthil Kumar",email:"senthil@maduraiagro.example",phone:"+91 98400 10002",gstin:"33AABCP1002A1Z2",lead:"Lakshmi Devi",leadCo:"Delta Farms Co-op",leadStatus:"CONTACTED" as const,score:62,source:1,deal:"Madurai Agro - Platform 1T",amount:68000,stage:1,owner:2,won:false,daysAgo:8},
  {account:"Tiruppur Knit Exports",city:"Tiruppur",industry:"Textiles",contact:"Anitha R",email:"anitha@tiruppurknit.example",phone:"+91 98400 10003",gstin:"33AABCP1003A1Z3",lead:"Murugan P",leadCo:"Knit Wear Hub",leadStatus:"QUALIFIED" as const,score:80,source:2,deal:"Tiruppur Knit - Table Top Pack",amount:52000,stage:3,owner:1,won:false,daysAgo:12},
  {account:"Salem Steel Works",city:"Salem",industry:"Manufacturing",contact:"Ganesh Babu",email:"ganesh@salemsteel.example",phone:"+91 98400 10004",gstin:"33AABCP1004A1Z4",lead:"Divya S",leadCo:"Salem Foundry Unit",leadStatus:"QUALIFIED" as const,score:88,source:3,deal:"Salem Steel - Industrial Scale",amount:245000,stage:4,owner:3,won:true,daysAgo:20},
  {account:"Trichy Medical Stores",city:"Tiruchirappalli",industry:"Healthcare",contact:"Dr. Kavitha N",email:"kavitha@trichymed.example",phone:"+91 98400 10005",gstin:"33AABCP1005A1Z5",lead:"Ramesh Iyer",leadCo:"City Clinic Chain",leadStatus:"CONVERTED" as const,score:90,source:0,deal:"Trichy Medical - Jewellery Scale",amount:28500,stage:4,owner:2,won:true,daysAgo:35},
 ];

 const createdAccounts=[];
 for(const [idx,row] of tnPack.entries()){
  const acc=await prisma.account.findFirst({where:{tenantId:tenant.id,name:row.account,deletedAt:null}})??await prisma.account.create({
    data:{id:uuid(),tenantId:tenant.id,name:row.account,accountType:"Customer",phone:row.phone,email:row.email,city:row.city,state:"Tamil Nadu",country:"IN",gstin:row.gstin,industry:row.industry,ownerUserId:agents[row.owner]?.id??user.id,description:`Tamil Nadu ${row.industry} customer — ${row.city}`},
  });
  createdAccounts.push(acc);
  const ct=await prisma.contact.findFirst({where:{tenantId:tenant.id,email:row.email,deletedAt:null}})??await prisma.contact.create({
    data:{id:uuid(),tenantId:tenant.id,accountId:acc.id,name:row.contact,email:row.email,phone:row.phone,phoneNormalized:row.phone.replace(/\D/g,""),title:"Decision Maker",city:row.city,state:"Tamil Nadu",country:"IN",ownerUserId:agents[row.owner]?.id??user.id,customFields:{whatsapp:row.phone,pincode:row.city==="Chennai"?"600001":row.city==="Madurai"?"625001":"641001"}},
  });
  const createdAt=new Date(); createdAt.setDate(createdAt.getDate()-row.daysAgo);
  const ld=await prisma.lead.findFirst({where:{tenantId:tenant.id,email:`lead${idx}@tn.example`,deletedAt:null}})??await prisma.lead.create({
    data:{id:uuid(),tenantId:tenant.id,name:row.lead,email:`lead${idx}@tn.example`,phone:row.phone,phoneNormalized:row.phone.replace(/\D/g,""),company:row.leadCo,city:row.city,state:"Tamil Nadu",country:"IN",sourceId:sources[row.source%sources.length].id,status:row.leadStatus,score:row.score,assignedToId:agents[row.owner]?.id??user.id,createdById:user.id,createdAt,customFields:{product_interest:row.deal,region:"Tamil Nadu"}},
  });
  const dealId=`20000000-0000-4000-8000-${String(idx+2).padStart(12,"0")}`;
  const stage=stages[Math.min(row.stage,stages.length-1)];
  await prisma.deal.upsert({
    where:{id:dealId},
    update:{amount:row.amount,stageId:stage.id,probability:stage.probability,deletedAt:null,closedAt:row.won?createdAt:null},
    create:{id:dealId,tenantId:tenant.id,name:row.deal,amount:row.amount,stageId:stage.id,probability:stage.probability,priority:row.amount>100000?"HIGH":"MEDIUM",contactId:ct.id,accountId:acc.id,ownerUserId:agents[row.owner]?.id??user.id,expectedCloseDate:new Date(Date.now()+7*86400000),closedAt:row.won?createdAt:null,createdAt,description:`TN opportunity — ${row.city}`},
  });
  // Activities (idempotent by title)
  for (const act of [
    { type: "CALL" as const, title: `Follow-up call — ${row.contact}`, status: "COMPLETED" as const, outcome: "Interested", done: true },
    { type: "TASK" as const, title: `Site visit — ${row.city}`, status: row.won ? ("COMPLETED" as const) : ("PENDING" as const), outcome: null, done: row.won },
    { type: "EMAIL" as const, title: `Quotation email — ${row.deal}`, status: "COMPLETED" as const, outcome: null, done: true },
  ]) {
    const exists = await prisma.activity.findFirst({ where: { tenantId: tenant.id, title: act.title, deletedAt: null } });
    if (!exists) {
      await prisma.activity.create({
        data: {
          id: uuid(),
          tenantId: tenant.id,
          type: act.type,
          title: act.title,
          status: act.status,
          leadId: ld.id,
          contactId: ct.id,
          accountId: acc.id,
          dealId: act.type === "EMAIL" ? dealId : null,
          assignedToId: agents[row.owner]?.id ?? user.id,
          completedAt: act.done ? createdAt : null,
          scheduledAt: act.type === "TASK" ? new Date(Date.now() + 2 * 86400000) : null,
          durationMinutes: act.type === "CALL" ? 15 : null,
          outcome: act.outcome,
          createdAt,
        },
      });
    }
  }
 }

 // Soft-delete older non-TN demo noise so dashboards show the 5 TN bases cleanly
 await prisma.account.updateMany({ where: { tenantId: tenant.id, name: "Metro Retail Systems", deletedAt: null }, data: { deletedAt: new Date() } });
 await prisma.contact.updateMany({ where: { tenantId: tenant.id, email: "rajesh@metro.example", deletedAt: null }, data: { deletedAt: new Date() } });
 await prisma.lead.updateMany({ where: { tenantId: tenant.id, email: { in: ["anita@factory.example", "extra0@tnleads.example", "extra1@tnleads.example", "extra2@tnleads.example"] }, deletedAt: null }, data: { deletedAt: new Date() } });
 await prisma.deal.updateMany({ where: { id: "20000000-0000-4000-8000-000000000001", deletedAt: null }, data: { deletedAt: new Date() } });

 // Sample invoices — one per TN account (5)
 for (const [i, acc] of createdAccounts.entries()) {
  const invId = `30000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`;
  const prod = products[i % products.length];
  const qty = 1 + (i % 3);
  const unit = Number(prod.salePrice);
  const tax = unit * qty * 0.18;
  const sub = unit * qty;
  const paid = tnPack[i]?.won;
  const invDate = new Date();
  invDate.setDate(invDate.getDate() - (tnPack[i]?.daysAgo ?? i * 5));
  const contact = await prisma.contact.findFirst({ where: { tenantId: tenant.id, accountId: acc.id, deletedAt: null } });
  await prisma.invoice.upsert({
    where: { id: invId },
    update: {
      accountId: acc.id,
      contactId: contact?.id ?? null,
      status: paid ? "PAID" : "SENT",
      subtotal: sub,
      taxTotal: tax,
      grandTotal: sub + tax,
      amountPaid: paid ? sub + tax : 0,
      deletedAt: null,
      notes: `Tamil Nadu delivery — ${acc.city}`,
    },
    create: {
      id: invId,
      tenantId: tenant.id,
      invoiceNumber: `INV-TN-${String(i + 1).padStart(4, "0")}`,
      accountId: acc.id,
      contactId: contact?.id ?? null,
      status: paid ? "PAID" : "SENT",
      invoiceDate: invDate,
      dueDate: new Date(invDate.getTime() + 15 * 86400000),
      subtotal: sub,
      taxTotal: tax,
      discountTotal: 0,
      grandTotal: sub + tax,
      amountPaid: paid ? sub + tax : 0,
      currency: "INR",
      notes: `Tamil Nadu delivery — ${acc.city}`,
      createdById: user.id,
    },
  });
  const lineExists = await prisma.invoiceLine.findFirst({ where: { tenantId: tenant.id, invoiceId: invId } });
  if (!lineExists) {
    await prisma.invoiceLine.create({
      data: {
        id: uuid(),
        tenantId: tenant.id,
        invoiceId: invId,
        productId: prod.id,
        description: prod.name,
        quantity: qty,
        unitPrice: unit,
        taxPercent: 18,
        lineTotal: sub + tax,
      },
    });
  }
 }

 // 5 support tickets — one per TN account
 const ticketSubjects = [
  "Weighbridge display blank after rain",
  "Platform scale calibration drift",
  "Request installation for counting scale",
  "Warranty claim — load cell fault",
  "Training needed for jewellery scale",
 ];
 for (const [i, acc] of createdAccounts.entries()) {
  const ticketId = `40000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`;
  const contact = await prisma.contact.findFirst({ where: { tenantId: tenant.id, accountId: acc.id, deletedAt: null } });
  const existingTicket = await prisma.ticket.findFirst({ where: { id: ticketId } });
  const ticketData = {
    subject: ticketSubjects[i] ?? `Support — ${acc.city}`,
    description: `Customer reported from ${acc.city}, Tamil Nadu. Account: ${acc.name}.`,
    priority: (i === 0 ? "HIGH" : i === 3 ? "CRITICAL" : "MEDIUM") as "HIGH" | "CRITICAL" | "MEDIUM",
    status: (i < 2 ? "OPEN" : i === 2 ? "IN_PROGRESS" : "RESOLVED") as "OPEN" | "IN_PROGRESS" | "RESOLVED",
    contactId: contact?.id ?? null,
    accountId: acc.id,
    productId: products[i % products.length]?.id ?? null,
    assignedToId: agents[(i % Math.max(agents.length - 1, 1)) + 1]?.id ?? user.id,
    customFields: {
      category: i === 3 ? "Warranty" : i === 2 ? "Installation" : "Breakdown",
      channel: "Phone",
      region: "Tamil Nadu",
      city: acc.city,
    },
    deletedAt: null as Date | null,
    resolvedAt: i >= 3 ? new Date() : null,
  };
  if (!existingTicket) {
    await prisma.ticket.create({
      data: {
        id: ticketId,
        tenantId: tenant.id,
        ticketNo: i + 1,
        ...ticketData,
      },
    });
  } else {
    await prisma.ticket.update({
      where: { id: ticketId },
      data: ticketData,
    });
  }
 }

 // 5 TN vendors for purchase orders
 const vendorDefs = [
  { name: "Coimbatore Loadcell Hub", city: "Coimbatore", phone: "+91 98410 30001", email: "sales@clh.example", gstin: "33AABCV1001A1Z1" },
  { name: "Chennai Steel Fabricators", city: "Chennai", phone: "+91 98410 30002", email: "orders@csf.example", gstin: "33AABCV1002A1Z2" },
  { name: "Madurai Display Electronics", city: "Madurai", phone: "+91 98410 30003", email: "info@mde.example", gstin: "33AABCV1003A1Z3" },
  { name: "Salem Weigh Parts", city: "Salem", phone: "+91 98410 30004", email: "parts@swp.example", gstin: "33AABCV1004A1Z4" },
  { name: "Tiruppur Pack Machines", city: "Tiruppur", phone: "+91 98410 30005", email: "pack@tpm.example", gstin: "33AABCV1005A1Z5" },
 ];
 for (const v of vendorDefs) {
  const exists = await prisma.vendor.findFirst({ where: { tenantId: tenant.id, name: v.name, deletedAt: null } });
  if (!exists) {
    await prisma.vendor.create({
      data: {
        id: uuid(),
        tenantId: tenant.id,
        name: v.name,
        phone: v.phone,
        email: v.email,
        gstin: v.gstin,
        paymentTerms: "Net 30",
        address: { city: v.city, state: "Tamil Nadu", country: "IN" },
        customFields: { region: "Tamil Nadu", city: v.city },
      },
    });
  }
 }
 // Soft-delete old generic vendor if present
 await prisma.vendor.updateMany({
   where: { tenantId: tenant.id, name: "SteelBase Components", deletedAt: null },
   data: { deletedAt: new Date() },
 });

 // Keep dashboards focused on the 5 TN pack (hide any legacy demo rows)
 const tnContactEmails = tnPack.map((r) => r.email);
 const tnLeadEmails = tnPack.map((_, i) => `lead${i}@tn.example`);
 const tnDealIds = tnPack.map((_, idx) => `20000000-0000-4000-8000-${String(idx + 2).padStart(12, "0")}`);
 const tnAccountNames = tnPack.map((r) => r.account);
 await prisma.contact.updateMany({
   where: { tenantId: tenant.id, deletedAt: null, email: { notIn: tnContactEmails } },
   data: { deletedAt: new Date() },
 });
 await prisma.lead.updateMany({
   where: {
     tenantId: tenant.id,
     deletedAt: null,
     OR: [{ email: null }, { email: { notIn: tnLeadEmails } }],
   },
   data: { deletedAt: new Date() },
 });
 await prisma.deal.updateMany({
   where: { tenantId: tenant.id, deletedAt: null, id: { notIn: tnDealIds } },
   data: { deletedAt: new Date() },
 });
 await prisma.account.updateMany({
   where: { tenantId: tenant.id, deletedAt: null, name: { notIn: tnAccountNames } },
   data: { deletedAt: new Date() },
 });

 for(const sequenceKey of ["INVOICE","SO","PO","TICKET"]){await prisma.numberSequence.upsert({where:{tenantId_sequenceKey:{tenantId:tenant.id,sequenceKey}},update:{nextValue:10},create:{tenantId:tenant.id,sequenceKey,prefix:`${sequenceKey}-`,nextValue:10,padding:5}})}
 for(const tip of tips){await prisma.featureTip.upsert({where:{id:tip.id},update:{...tip,isActive:true},create:{...tip,tenantId:null}})}
 console.log(`Seeded ${tenant.name}; admin demo@precisionscales.in / Demo@12345; TN accounts ${createdAccounts.length}; agents ${agents.length-1}; products ${products.length}.`);
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>prisma.$disconnect());
