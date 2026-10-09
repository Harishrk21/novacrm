/** Plan → limits + default modules (platform onboarding). */

export type TenantPlanCode = "STARTER" | "GROWTH" | "BUSINESS" | "ENTERPRISE";

/** What the client subscribed to — drives module on/off (sidebar + API). */
export type SubscriptionPack = "SALES" | "SALES_INVENTORY" | "HMS_FULL";

export type PlanDefinition = {
  code: TenantPlanCode;
  label: string;
  maxUsers: number;
  /** true = unlimited-ish high cap */
  unlimitedUsers?: boolean;
  modules: Record<string, boolean>;
  features: {
    hmsPack: boolean;
    erpFull: boolean;
    whatsapp: boolean;
    automation: boolean;
    customFields: boolean;
    ai: boolean;
    api: boolean;
  };
};

const CRM_CORE: Record<string, boolean> = {
  "crm.leads": true,
  "crm.contacts": true,
  "crm.accounts": true,
  "crm.deals": true,
  "crm.activities": true,
  reports: true,
  settings: true,
};

const HMS_PACK: Record<string, boolean> = {
  "crm.tickets": true,
  "crm.amc": true,
  "crm.stamping": true,
  "crm.rentals": true,
};

const ERP_FULL: Record<string, boolean> = {
  "erp.products": true,
  "erp.inventory": true,
  "erp.purchase_orders": true,
  "erp.invoices": true,
};

const ALL_OFF_SERVICE: Record<string, boolean> = {
  "crm.tickets": false,
  "crm.amc": false,
  "crm.stamping": false,
  "crm.rentals": false,
};

const ALL_OFF_ERP: Record<string, boolean> = {
  "erp.products": false,
  "erp.inventory": false,
  "erp.purchase_orders": false,
  "erp.invoices": false,
};

/** Named subscription packs for platform onboarding (clearer than plan alone). */
export const SUBSCRIPTION_PACKS: Record<
  SubscriptionPack,
  {
    code: SubscriptionPack;
    label: string;
    description: string;
    defaultMaxUsers: number;
    modules: Record<string, boolean>;
  }
> = {
  SALES: {
    code: "SALES",
    label: "Sales only",
    description: "Leads, contacts, deals, activities, reports — no service tickets or stock",
    defaultMaxUsers: 5,
    modules: {
      ...CRM_CORE,
      ...ALL_OFF_SERVICE,
      ...ALL_OFF_ERP,
      "engagement.whatsapp": false,
      "engagement.emails": true,
    },
  },
  SALES_INVENTORY: {
    code: "SALES_INVENTORY",
    label: "Sales + Inventory",
    description: "Sales CRM plus products, stock, purchase orders and proforma invoices",
    defaultMaxUsers: 15,
    modules: {
      ...CRM_CORE,
      ...ALL_OFF_SERVICE,
      ...ERP_FULL,
      "engagement.whatsapp": true,
      "engagement.emails": true,
    },
  },
  HMS_FULL: {
    code: "HMS_FULL",
    label: "HMS / Full ops",
    description: "Sales + service tickets + AMC + stamping + full inventory / ERP",
    defaultMaxUsers: 25,
    modules: {
      ...CRM_CORE,
      ...HMS_PACK,
      ...ERP_FULL,
      "engagement.whatsapp": true,
      "engagement.emails": true,
      reports: true,
      settings: true,
    },
  },
};

/** Fresh client shell — platform turns modules on after create. */
export function blankOnboardModules(): Record<string, boolean> {
  return {
    "crm.leads": false,
    "crm.contacts": true,
    "crm.accounts": false,
    "crm.deals": false,
    "crm.activities": false,
    ...ALL_OFF_SERVICE,
    ...ALL_OFF_ERP,
    "engagement.whatsapp": false,
    "engagement.emails": false,
    reports: false,
    settings: true,
  };
}

export function modulesForSubscription(
  pack: SubscriptionPack | string | undefined,
  override?: Record<string, boolean>,
): { modules: Record<string, boolean>; defaultMaxUsers: number; pack: SubscriptionPack } {
  const code = (pack && pack in SUBSCRIPTION_PACKS ? pack : "SALES") as SubscriptionPack;
  const def = SUBSCRIPTION_PACKS[code];
  const modules = { ...def.modules, ...(override ?? {}) };
  return { modules, defaultMaxUsers: def.defaultMaxUsers, pack: code };
}

export const PLAN_CATALOG: Record<TenantPlanCode, PlanDefinition> = {
  STARTER: {
    code: "STARTER",
    label: "Starter",
    maxUsers: 5,
    modules: SUBSCRIPTION_PACKS.SALES.modules,
    features: {
      hmsPack: false,
      erpFull: false,
      whatsapp: false,
      automation: false,
      customFields: false,
      ai: false,
      api: false,
    },
  },
  GROWTH: {
    code: "GROWTH",
    label: "Growth",
    maxUsers: 15,
    modules: SUBSCRIPTION_PACKS.SALES_INVENTORY.modules,
    features: {
      hmsPack: false,
      erpFull: true,
      whatsapp: true,
      automation: true,
      customFields: true,
      ai: false,
      api: true,
    },
  },
  BUSINESS: {
    code: "BUSINESS",
    label: "Business",
    maxUsers: 50,
    modules: SUBSCRIPTION_PACKS.HMS_FULL.modules,
    features: {
      hmsPack: true,
      erpFull: true,
      whatsapp: true,
      automation: true,
      customFields: true,
      ai: true,
      api: true,
    },
  },
  ENTERPRISE: {
    code: "ENTERPRISE",
    label: "Enterprise",
    maxUsers: 500,
    unlimitedUsers: true,
    modules: SUBSCRIPTION_PACKS.HMS_FULL.modules,
    features: {
      hmsPack: true,
      erpFull: true,
      whatsapp: true,
      automation: true,
      customFields: true,
      ai: true,
      api: true,
    },
  },
};

/** Prefer subscriptionPack when set; else plan + legacy template. */
export function modulesForPlan(
  plan: TenantPlanCode | string | undefined,
  opts?: {
    template?: "HMS" | "STANDARD";
    subscriptionPack?: SubscriptionPack | string;
    override?: Record<string, boolean>;
  },
): {
  modules: Record<string, boolean>;
  maxUsers: number;
  features: PlanDefinition["features"];
  subscriptionPack?: SubscriptionPack;
} {
  if (opts?.subscriptionPack && opts.subscriptionPack in SUBSCRIPTION_PACKS) {
    const sub = modulesForSubscription(opts.subscriptionPack, opts.override);
    const code = (plan && plan in PLAN_CATALOG ? plan : "STARTER") as TenantPlanCode;
    return {
      modules: sub.modules,
      maxUsers: PLAN_CATALOG[code].maxUsers,
      features: PLAN_CATALOG[code].features,
      subscriptionPack: sub.pack,
    };
  }

  const code = (plan && plan in PLAN_CATALOG ? plan : "STARTER") as TenantPlanCode;
  const def = PLAN_CATALOG[code];
  let modules = { ...def.modules };
  if (opts?.template === "HMS") {
    modules = { ...modules, ...HMS_PACK, ...ERP_FULL, "engagement.whatsapp": true };
  }
  if (opts?.template === "STANDARD") {
    modules = { ...SUBSCRIPTION_PACKS.SALES.modules, "erp.products": true, "erp.invoices": true };
  }
  if (opts?.override) modules = { ...modules, ...opts.override };
  return { modules, maxUsers: def.maxUsers, features: def.features };
}

export function listSubscriptionPacks() {
  return Object.values(SUBSCRIPTION_PACKS);
}

export const SERVICE_TYPES = ["SALES", "SERVICE", "STAMPING", "RENTAL"] as const;
export type ServiceType = (typeof SERVICE_TYPES)[number];
