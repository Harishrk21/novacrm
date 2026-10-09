import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  BarChart3,
  UserPlus,
  Users,
  Phone,
  Ticket,
  Mail,
  Settings,
  UserCog,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Package,
  Warehouse,
  FileText,
  ShoppingCart,
  BookOpen,
  CheckSquare,
  Shield,
  Stamp,
  Truck,
  Wrench,
  Plus,
  LogOut,
  Bell,
  SlidersHorizontal,
  ListTodo,
  Briefcase,
  CalendarDays,
  Boxes,
  MoreHorizontal,
  Upload,
  PackageCheck,
  Filter,
  AlertTriangle,
  ClipboardList,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/store/uiStore'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { HmsLogo } from '@/components/HmsLogo'
import { useAuthStore } from '@/store/authStore'
import { useModulesStore } from '@/store/modulesStore'
import {
  isCompanyAdmin,
  isServiceDesk,
  isServiceEngineer,
  isSalesExecutive,
  isWarehouse,
  roleLabel,
} from '@/lib/roles'
import { APP_NAME } from '@/lib/branding'

type NavQuickAction = {
  label: string
  to: string
  icon?: typeof LayoutDashboard
  /** Only company admins see this */
  adminOnly?: boolean
}

type NavItem = {
  to: string
  icon: typeof LayoutDashboard
  label: string
  end?: boolean
  badge?: string
  badgeColor?: 'amber' | 'green' | 'blue'
  quickActions?: NavQuickAction[]
}

type NavSection = {
  label: string
  icon?: typeof Briefcase
  collapsible?: boolean
  items: NavItem[]
}

function pathMatchesItem(
  pathname: string,
  search: string,
  item: NavItem,
  siblings?: NavItem[],
) {
  const [path, query] = item.to.split('?')
  if (item.end) return pathname === path
  if (path === '/') return pathname === '/'

  const pathOk = pathname === path || pathname.startsWith(`${path}/`)
  if (!pathOk) return false

  // Query-specific items (e.g. ?queue=release) must match those params
  if (query) {
    const required = new URLSearchParams(query)
    const current = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
    for (const [k, v] of required) {
      if (current.get(k) !== v) return false
    }
    return true
  }

  // Path-only items lose to a sibling that matches with query params
  // (fixes Proforma + Approved releases both active on ?queue=release)
  if (
    siblings?.some((sib) => {
      if (sib.to === item.to) return false
      const [sibPath, sibQuery] = sib.to.split('?')
      if (!sibQuery || sibPath !== path) return false
      return pathMatchesItem(pathname, search, sib)
    })
  ) {
    return false
  }

  return true
}

function sectionHasActive(pathname: string, search: string, section: NavSection) {
  return section.items.some((item) => pathMatchesItem(pathname, search, item))
}

function NavItemRow({
  item,
  isAdmin,
  collapsed,
  siblings,
}: {
  item: NavItem
  isAdmin: boolean
  collapsed?: boolean
  siblings?: NavItem[]
}) {
  const navigate = useNavigate()
  const location = useLocation()
  const active = pathMatchesItem(location.pathname, location.search, item, siblings)
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null)
  const wrapRef = useRef<HTMLLIElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const actions = (item.quickActions ?? []).filter((a) => !a.adminOnly || isAdmin)

  useEffect(() => {
    if (!menuOpen) return
    function place() {
      const el = btnRef.current ?? wrapRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      setMenuPos({ top: r.top, left: r.right + 6 })
    }
    place()
    function onDoc(e: MouseEvent) {
      const target = e.target as Node
      if (wrapRef.current?.contains(target)) return
      const menu = document.getElementById(`nav-flyout-${item.label}`)
      if (menu?.contains(target)) return
      setMenuOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen, item.label])

  if (collapsed) {
    return (
      <li>
        <NavLink
          to={item.to}
          end={item.end}
          title={item.label}
          className={cn(
            'group relative flex items-center justify-center rounded-lg px-2 py-[9px] text-[13px] font-medium transition-all duration-150',
            active
              ? 'bg-[color:var(--color-accent-blue)]/18 text-white shadow-[inset_3px_0_0_0_var(--color-accent-blue)]'
              : 'text-sidebar-text hover:bg-white/[0.06] hover:text-white',
          )}
        >
          <item.icon size={17} className="shrink-0 opacity-90" strokeWidth={1.75} />
        </NavLink>
      </li>
    )
  }

  return (
    <li ref={wrapRef} className="relative">
      <div
        className={cn(
          'group relative flex items-center rounded-lg transition-all duration-150',
          menuOpen && 'bg-white/[0.06]',
        )}
      >
        <NavLink
          to={item.to}
          end={item.end}
          className={cn(
            'flex min-w-0 flex-1 items-center gap-3 rounded-lg px-3 py-[8px] text-[13px] font-medium transition-all duration-150',
            active
              ? 'bg-[color:var(--color-accent-blue)]/18 text-white shadow-[inset_3px_0_0_0_var(--color-accent-blue)]'
              : 'text-sidebar-text hover:bg-white/[0.06] hover:text-white',
          )}
        >
          <item.icon size={16} className="shrink-0 opacity-90" strokeWidth={1.75} />
          <span className="flex-1 truncate">{item.label}</span>
          {item.badge && (
            <Badge color={item.badgeColor ?? 'amber'} className="px-1.5 text-[9px]">
              {item.badge}
            </Badge>
          )}
        </NavLink>
        {actions.length > 0 ? (
          <button
            ref={btnRef}
            type="button"
            title={`${item.label} options`}
            aria-label={`${item.label} options`}
            aria-expanded={menuOpen}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              const r = (e.currentTarget as HTMLButtonElement).getBoundingClientRect()
              setMenuPos({ top: r.top, left: r.right + 6 })
              setMenuOpen((o) => !o)
            }}
            className={cn(
              'mr-1 flex size-7 shrink-0 items-center justify-center rounded-md text-white/50 transition',
              'opacity-0 hover:bg-white/10 hover:text-white group-hover:opacity-100 focus:opacity-100',
              menuOpen && 'opacity-100 bg-white/10 text-white',
            )}
          >
            <MoreHorizontal size={14} />
          </button>
        ) : null}
      </div>

      {menuOpen && actions.length > 0 && menuPos
        ? createPortal(
            <div
              id={`nav-flyout-${item.label}`}
              className="fixed z-[200] w-56 overflow-hidden rounded-lg border border-border bg-card py-1 shadow-[0_12px_40px_rgba(0,0,0,0.35)]"
              style={{ top: menuPos.top, left: menuPos.left }}
              role="menu"
            >
              <div className="border-b border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-secondary">
                {item.label}
              </div>
              {actions.map((action) => {
                const Icon = action.icon ?? Plus
                return (
                  <button
                    key={`${action.label}-${action.to}`}
                    type="button"
                    role="menuitem"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text-primary hover:bg-muted/70"
                    onClick={() => {
                      setMenuOpen(false)
                      navigate(action.to)
                    }}
                  >
                    <Icon size={14} className="shrink-0 text-accent-blue" />
                    <span className="truncate">{action.label}</span>
                  </button>
                )
              })}
            </div>,
            document.body,
          )
        : null}
    </li>
  )
}

export function Sidebar() {
  const navigate = useNavigate()
  const location = useLocation()
  const collapsed = useUIStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)
  const addToast = useUIStore((s) => s.addToast)
  const authUser = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)
  const moduleOn = useModulesStore((s) => s.enabled)
  const displayName = authUser?.name ?? 'User'
  const role = authUser?.role
  const isAdmin = isCompanyAdmin(role)
  const displayRole = roleLabel(role)
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({})

  async function handleLogout() {
    try {
      await logout()
      addToast({ type: 'success', message: 'Signed out' })
    } finally {
      navigate(authUser?.tenantSlug ? `/login/${authUser.tenantSlug}` : '/login', { replace: true })
    }
  }

  const contactsActions: NavQuickAction[] = [
    { label: 'Create Contact', to: '/contacts?open=1', icon: UserPlus },
    { label: 'Import Contacts', to: '/contacts?tab=import', icon: Upload, adminOnly: true },
    { label: 'With machines', to: '/contacts?filter=machines', icon: Package },
    { label: 'Open service jobs', to: '/contacts?filter=openJobs', icon: Ticket },
  ]

  const leadsActions: NavQuickAction[] = [
    { label: 'New lead', to: '/sale-tracking?open=1', icon: Plus },
    { label: 'Pending requisitions', to: '/sale-tracking?queue=requisitions', icon: Filter },
    { label: 'My leads', to: '/sale-tracking', icon: Filter },
  ]

  const ticketsActions: NavQuickAction[] = [
    { label: 'New service ticket', to: '/tickets?open=1&job=service', icon: Plus },
    { label: 'In progress', to: '/tickets?queue=progress', icon: ListTodo },
    { label: 'Awaiting assign', to: '/tickets?queue=awaiting', icon: AlertTriangle },
    { label: 'Pending approval', to: '/tickets?queue=approval', icon: CheckSquare },
  ]

  const spareActions: NavQuickAction[] = [
    { label: 'Spare parts log', to: '/spare-parts', icon: Wrench },
    { label: 'Service reports', to: '/service-reports', icon: FileText },
  ]

  const amcActions: NavQuickAction[] = [
    { label: 'AMC register', to: '/amc', icon: Shield },
    { label: 'AMC visit ticket', to: '/tickets?open=1&category=AMC%20visit', icon: Ticket },
  ]

  const stampingActions: NavQuickAction[] = [
    { label: 'Stamping due', to: '/stamping', icon: Stamp },
    { label: 'New stamping job', to: '/tickets?open=1&job=stamping&category=Stamping', icon: Plus },
  ]

  const rentalsActions: NavQuickAction[] = [
    { label: 'Issue rental', to: '/rentals?open=1', icon: Truck },
    { label: 'Active rentals', to: '/rentals', icon: Filter },
  ]

  const adminNav: NavSection[] = [
    {
      label: 'Home',
      icon: LayoutDashboard,
      collapsible: false,
      items: [
        { to: '/', icon: LayoutDashboard, label: 'Dashboard', end: true },
        { to: '/workqueue', icon: ListTodo, label: 'Workqueue' },
        { to: '/notifications', icon: Bell, label: 'Notifications' },
        { to: '/help', icon: BookOpen, label: 'How it works' },
        ...(moduleOn('reports')
          ? [{ to: '/reports', icon: BarChart3, label: 'Reports' } as NavItem]
          : []),
      ],
    },
    {
      label: 'Sales',
      icon: Briefcase,
      collapsible: true,
      items: [
        ...(moduleOn('crm.leads')
          ? [
              {
                to: '/sale-tracking',
                icon: UserPlus,
                label: 'My leads',
                quickActions: leadsActions,
              } as NavItem,
            ]
          : []),
        ...(moduleOn('crm.contacts')
          ? [
              {
                to: '/contacts',
                icon: Users,
                label: 'Contacts',
                quickActions: contactsActions,
              } as NavItem,
            ]
          : []),
      ].filter(Boolean),
    },
    {
      label: 'Activities',
      icon: CalendarDays,
      collapsible: true,
      items: moduleOn('crm.activities')
        ? [
            { to: '/activities', icon: Phone, label: 'Calls & tasks' },
            { to: '/my-tasks', icon: CheckSquare, label: 'My tasks' },
          ]
        : [],
    },
    {
      label: 'Service',
      icon: Ticket,
      collapsible: true,
      items: [
        ...(moduleOn('crm.tickets')
          ? [
              {
                to: '/tickets',
                icon: Ticket,
                label: 'Service tickets',
                quickActions: ticketsActions,
              } as NavItem,
            ]
          : []),
        ...(moduleOn('crm.tickets')
          ? [
              {
                to: '/spare-parts',
                icon: Wrench,
                label: 'Spare parts',
                quickActions: spareActions,
              } as NavItem,
              {
                to: '/service-reports',
                icon: FileText,
                label: 'Service reports',
              } as NavItem,
            ]
          : []),
        ...(moduleOn('crm.amc')
          ? [{ to: '/amc', icon: Shield, label: 'AMC / Non-AMC', quickActions: amcActions } as NavItem]
          : []),
        ...(moduleOn('crm.stamping')
          ? [
              {
                to: '/stamping',
                icon: Stamp,
                label: 'Stamping',
                quickActions: stampingActions,
              } as NavItem,
            ]
          : []),
        ...(moduleOn('crm.rentals')
          ? [
              {
                to: '/rentals',
                icon: Truck,
                label: 'Rentals',
                quickActions: rentalsActions,
              } as NavItem,
            ]
          : []),
      ].filter(Boolean),
    },
    {
      label: 'Inventory',
      icon: Boxes,
      collapsible: true,
      items: [
        ...(moduleOn('erp.products') || moduleOn('erp.inventory')
          ? [
              {
                to: '/erp/products',
                icon: Package,
                label: 'Products',
                quickActions: [
                  {
                    label: 'Add product',
                    to: '/erp/products?open=1',
                    icon: Plus,
                  },
                ],
              } as NavItem,
            ]
          : []),
        ...(moduleOn('erp.inventory')
          ? [
              {
                to: '/erp/stock',
                icon: Warehouse,
                label: 'Stock',
                quickActions: [
                  { label: 'Add stock', to: '/erp/stock/move', icon: Plus },
                  { label: 'Reduce stock', to: '/erp/stock/move?mode=reduce', icon: Filter },
                  { label: 'History', to: '/erp/stock?view=history', icon: Filter },
                  { label: 'Monthly report', to: '/erp/stock/report', icon: Filter },
                ],
              } as NavItem,
            ]
          : []),
        ...(moduleOn('erp.inventory')
          ? [
              { to: '/erp/releases', icon: PackageCheck, label: 'Approved releases' } as NavItem,
              {
                to: '/erp/delivery-challans',
                icon: ClipboardList,
                label: 'Delivery challans',
              } as NavItem,
            ]
          : []),
        ...(moduleOn('erp.purchase_orders') || moduleOn('erp.inventory')
          ? [{ to: '/erp/suppliers', icon: Truck, label: 'Suppliers' } as NavItem]
          : []),
        ...(moduleOn('erp.purchase_orders')
          ? [{ to: '/erp/purchase-orders', icon: ShoppingCart, label: 'Purchase Orders' } as NavItem]
          : []),
        ...(moduleOn('erp.invoices')
          ? [{ to: '/erp/invoices', icon: FileText, label: 'Proforma invoices' } as NavItem]
          : []),
      ].filter(Boolean),
    },
    {
      label: 'System',
      icon: Settings,
      collapsible: true,
      items: [
        ...(moduleOn('engagement.emails')
          ? [{ to: '/emails', icon: Mail, label: 'Emails' } as NavItem]
          : []),
        { to: '/setup', icon: SlidersHorizontal, label: 'Setup' },
        { to: '/settings', icon: Settings, label: 'Settings' },
        { to: '/users', icon: UserCog, label: 'Users & Roles' },
      ],
    },
  ]
    .map((section) => ({
      ...section,
      items: section.items.filter(Boolean) as NavItem[],
    }))
    .filter((section) => section.items.length > 0)

  /** Same dropdown pattern as admin: Home (flat) + role sections + Inventory + Account */
  const deskNav: NavSection[] = [
    {
      label: 'Home',
      icon: LayoutDashboard,
      collapsible: false,
      items: [
        { to: '/', icon: LayoutDashboard, label: 'Dashboard', end: true },
        { to: '/workqueue', icon: ListTodo, label: 'Workqueue' },
        { to: '/notifications', icon: Bell, label: 'Notifications' },
        { to: '/help', icon: BookOpen, label: 'How it works' },
      ],
    },
    {
      label: 'Service',
      icon: Ticket,
      collapsible: true,
      items: [
        {
          to: '/tickets',
          icon: Ticket,
          label: 'Service tickets',
          quickActions: ticketsActions.filter((a) => !a.adminOnly),
        },
        { to: '/tickets?open=1', icon: Plus, label: 'New ticket' },
        {
          to: '/sale-tracking',
          icon: UserPlus,
          label: 'Service intake',
          quickActions: [
            { label: 'Log today’s call', to: '/sale-tracking?open=1&today=1', icon: Plus },
            { label: 'Today’s intake', to: '/sale-tracking?today=1', icon: Filter },
            { label: 'Open intake list', to: '/sale-tracking', icon: Filter },
          ],
        },
        {
          to: '/spare-parts',
          icon: Wrench,
          label: 'Spare parts',
          quickActions: spareActions,
        },
        { to: '/service-reports', icon: FileText, label: 'Service reports' },
      ],
    },
    {
      label: 'Customers',
      icon: Users,
      collapsible: true,
      items: [
        {
          to: '/contacts',
          icon: Users,
          label: 'Contacts',
          quickActions: contactsActions.filter((a) => !a.adminOnly),
        },
      ],
    },
    {
      label: 'Inventory',
      icon: Boxes,
      collapsible: true,
      items: [
        { to: '/erp/products', icon: Package, label: 'Products' },
        { to: '/erp/stock', icon: Warehouse, label: 'Stock' },
        { to: '/erp/suppliers', icon: Truck, label: 'Suppliers' },
      ],
    },
    {
      label: 'Account',
      icon: Settings,
      collapsible: true,
      items: [{ to: '/settings', icon: Settings, label: 'My Profile' }],
    },
  ]

  const engineerNav: NavSection[] = [
    {
      label: 'Home',
      icon: LayoutDashboard,
      collapsible: false,
      items: [
        { to: '/', icon: LayoutDashboard, label: 'Dashboard', end: true },
        { to: '/workqueue', icon: ListTodo, label: 'Workqueue' },
        { to: '/notifications', icon: Bell, label: 'Notifications' },
        { to: '/help', icon: BookOpen, label: 'How it works' },
      ],
    },
    {
      label: 'Service',
      icon: Ticket,
      collapsible: true,
      items: [
        {
          to: '/tickets',
          icon: Ticket,
          label: 'My tickets',
          quickActions: [
            { label: 'Open to accept', to: '/workqueue', icon: ListTodo },
            { label: 'In progress', to: '/tickets?queue=progress', icon: ListTodo },
            { label: 'Spare parts log', to: '/spare-parts', icon: Wrench },
          ],
        },
        { to: '/spare-parts', icon: Wrench, label: 'Spare parts' },
        { to: '/service-reports', icon: FileText, label: 'Service reports' },
      ],
    },
    {
      label: 'Customers',
      icon: Users,
      collapsible: true,
      items: [
        {
          to: '/contacts',
          icon: Users,
          label: 'Contacts',
          quickActions: [{ label: 'Lookup contacts', to: '/contacts', icon: Users }],
        },
      ],
    },
    {
      label: 'Inventory',
      icon: Boxes,
      collapsible: true,
      items: [
        { to: '/erp/products', icon: Package, label: 'Products' },
        { to: '/erp/stock', icon: Warehouse, label: 'Stock' },
        { to: '/erp/suppliers', icon: Truck, label: 'Suppliers' },
      ],
    },
    {
      label: 'Account',
      icon: Settings,
      collapsible: true,
      items: [{ to: '/settings', icon: Settings, label: 'My Profile' }],
    },
  ]

  const salesNav: NavSection[] = [
    {
      label: 'Home',
      icon: LayoutDashboard,
      collapsible: false,
      items: [
        { to: '/', icon: LayoutDashboard, label: 'Dashboard', end: true },
        { to: '/workqueue', icon: ListTodo, label: 'Workqueue' },
        { to: '/notifications', icon: Bell, label: 'Notifications' },
        { to: '/help', icon: BookOpen, label: 'How it works' },
      ],
    },
    {
      label: 'Sales',
      icon: Briefcase,
      collapsible: true,
      items: [
        {
          to: '/sale-tracking',
          icon: UserPlus,
          label: 'My leads',
          quickActions: leadsActions,
        },
        {
          to: '/contacts',
          icon: Users,
          label: 'Contacts',
          quickActions: contactsActions.filter((a) => !a.adminOnly),
        },
      ],
    },
    {
      label: 'Inventory',
      icon: Boxes,
      collapsible: true,
      items: [
        { to: '/erp/products', icon: Package, label: 'Products' },
        { to: '/erp/stock', icon: Warehouse, label: 'Stock' },
        { to: '/erp/suppliers', icon: Truck, label: 'Suppliers' },
      ],
    },
    {
      label: 'Account',
      icon: Settings,
      collapsible: true,
      items: [{ to: '/settings', icon: Settings, label: 'My Profile' }],
    },
  ]

  const warehouseNav: NavSection[] = [
    {
      label: 'Home',
      icon: LayoutDashboard,
      collapsible: false,
      items: [
        { to: '/', icon: LayoutDashboard, label: 'Dashboard', end: true },
        { to: '/notifications', icon: Bell, label: 'Notifications' },
        { to: '/help', icon: BookOpen, label: 'How it works' },
      ],
    },
    {
      label: 'Inventory',
      icon: Boxes,
      collapsible: true,
      items: [
        { to: '/erp/products', icon: Package, label: 'Products' },
        {
          to: '/erp/stock',
          icon: Warehouse,
          label: 'Stock',
          quickActions: [
            { label: 'Add stock', to: '/erp/stock/move', icon: Plus },
            { label: 'Reduce stock', to: '/erp/stock/move?mode=reduce', icon: Filter },
            { label: 'History', to: '/erp/stock?view=history', icon: Filter },
            { label: 'Monthly report', to: '/erp/stock/report', icon: Filter },
          ],
        },
        { to: '/erp/suppliers', icon: Truck, label: 'Suppliers' },
        { to: '/erp/releases', icon: PackageCheck, label: 'Approved releases' },
        { to: '/erp/delivery-challans', icon: ClipboardList, label: 'Delivery challans' },
      ],
    },
    {
      label: 'Customers',
      icon: Users,
      collapsible: true,
      items: [
        {
          to: '/contacts',
          icon: Users,
          label: 'Contacts',
          quickActions: contactsActions.filter((a) => !a.adminOnly),
        },
      ],
    },
    {
      label: 'Account',
      icon: Settings,
      collapsible: true,
      items: [{ to: '/settings', icon: Settings, label: 'My Profile' }],
    },
  ]

  const fallbackNav: NavSection[] = [
    {
      label: 'Home',
      icon: LayoutDashboard,
      collapsible: false,
      items: [
        { to: '/', icon: LayoutDashboard, label: 'Dashboard', end: true },
        { to: '/notifications', icon: Bell, label: 'Notifications' },
        { to: '/help', icon: BookOpen, label: 'How it works' },
      ],
    },
    {
      label: 'My work',
      icon: ListTodo,
      collapsible: true,
      items: [
        {
          to: '/tickets',
          icon: Ticket,
          label: 'My Tickets',
          quickActions: ticketsActions.filter((a) => !a.adminOnly),
        },
        { to: '/my-tasks', icon: CheckSquare, label: 'My Tasks' },
        {
          to: '/contacts',
          icon: Users,
          label: 'Contacts',
          quickActions: contactsActions.filter((a) => !a.adminOnly),
        },
      ],
    },
    {
      label: 'Account',
      icon: Settings,
      collapsible: true,
      items: [{ to: '/settings', icon: Settings, label: 'My Profile' }],
    },
  ]

  const navSections = isAdmin
    ? adminNav
    : isServiceDesk(role)
      ? deskNav
      : isSalesExecutive(role)
        ? salesNav
        : isServiceEngineer(role)
          ? engineerNav
          : isWarehouse(role)
            ? warehouseNav
            : fallbackNav

  useEffect(() => {
    setOpenSections((prev) => {
      const next = { ...prev }
      for (const section of navSections) {
        if (!section.collapsible) {
          next[section.label] = true
          continue
        }
        if (sectionHasActive(location.pathname, location.search, section)) {
          next[section.label] = true
        } else if (next[section.label] === undefined) {
          next[section.label] = false
        }
      }
      return next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to route / role nav shape
  }, [location.pathname, location.search, isAdmin, role])

  const banner =
    isServiceDesk(role)
      ? {
          title: 'Service desk',
          body: 'Create tickets, collect payment, mark complete & close — engineers Accept from the pool',
        }
      : isSalesExecutive(role)
        ? { title: 'Sales executive', body: 'Create leads, issue demos, post day-wise updates' }
        : isServiceEngineer(role)
          ? { title: 'Field engineer', body: 'Work assigned tickets and log day notes' }
          : isWarehouse(role)
            ? {
                title: 'Warehouse & billing',
                body: 'Stock, catalog, demo returns & proforma invoices (final GST bill in Tally)',
              }
            : !isAdmin
              ? { title: 'My work', body: 'Tickets and customer lookup' }
              : null

  function toggleSection(label: string) {
    setOpenSections((prev) => ({ ...prev, [label]: !prev[label] }))
  }

  const flatCollapsedItems = useMemo(
    () => navSections.flatMap((s) => s.items),
    [navSections],
  )

  return (
    <aside
      className={cn(
        'zcrm-sidebar flex h-full flex-col border-r border-white/5 bg-sidebar-bg text-sidebar-text transition-all duration-150',
        collapsed ? 'w-[68px]' : 'w-[248px]',
      )}
    >
      <div className={cn('flex h-14 items-center border-b border-white/8 px-3', collapsed && 'justify-center px-2')}>
        {collapsed ? (
          <img
            src="/hms-logo.png"
            alt={APP_NAME}
            className="h-8 w-auto max-w-[44px] object-contain object-left"
            draggable={false}
          />
        ) : (
          <div className="min-w-0 px-1 py-1">
            <HmsLogo size="sm" />
          </div>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto overflow-x-visible py-2">
        {!collapsed && banner ? (
          <div className="mb-2 mx-2 rounded-lg border border-white/8 bg-white/[0.04] px-3 py-2">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--color-accent-blue)]">
              {banner.title}
            </div>
            <div className="mt-0.5 text-[11px] leading-snug text-sidebar-text/90">{banner.body}</div>
          </div>
        ) : null}

        {collapsed ? (
          <ul className="space-y-0.5 px-2">
            {flatCollapsedItems.map((item) => (
              <NavItemRow
                key={`${item.to}-${item.label}`}
                item={item}
                isAdmin={isAdmin}
                collapsed
                siblings={flatCollapsedItems}
              />
            ))}
          </ul>
        ) : (
          navSections.map((section, sectionIdx) => {
            const isOpen = section.collapsible === false || Boolean(openSections[section.label])
            const active = sectionHasActive(location.pathname, location.search, section)
            const SectionIcon = section.icon

            return (
              <div key={section.label} className={cn('mb-1', sectionIdx > 0 && 'mt-1.5')}>
                {section.collapsible !== false ? (
                  <button
                    type="button"
                    onClick={() => toggleSection(section.label)}
                    className={cn(
                      'mx-2 flex w-[calc(100%-1rem)] items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors',
                      active
                        ? 'bg-white/[0.07] text-white'
                        : 'text-sidebar-text hover:bg-white/[0.05] hover:text-white',
                    )}
                  >
                    {SectionIcon ? (
                      <SectionIcon
                        size={15}
                        className="shrink-0 text-[color:var(--color-accent-blue)]"
                        strokeWidth={2}
                      />
                    ) : (
                      <span className="h-3.5 w-3.5 shrink-0" />
                    )}
                    <span className="flex-1 truncate text-[12px] font-semibold tracking-wide">
                      {section.label}
                    </span>
                    <ChevronDown
                      size={14}
                      className={cn(
                        'shrink-0 text-white/45 transition-transform duration-150',
                        isOpen && 'rotate-180',
                      )}
                    />
                  </button>
                ) : (
                  <div className="mb-1.5 flex items-center gap-2 px-4 pt-1">
                    {SectionIcon ? (
                      <SectionIcon
                        size={13}
                        className="text-[color:var(--color-accent-blue)] opacity-90"
                        strokeWidth={2}
                      />
                    ) : null}
                    <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-white/45">
                      {section.label}
                    </div>
                  </div>
                )}

                {isOpen && (
                  <ul
                    className={cn(
                      'space-y-0.5 px-2',
                      section.collapsible !== false && 'pb-1 pl-2',
                    )}
                  >
                    {section.items.map((item) => (
                      <NavItemRow
                        key={`${item.to}-${item.label}`}
                        item={item}
                        isAdmin={isAdmin}
                        siblings={section.items}
                      />
                    ))}
                  </ul>
                )}
              </div>
            )
          })
        )}
      </nav>

      <div className="border-t border-white/8 p-2">
        <button
          onClick={toggleSidebar}
          className="mb-1 flex w-full items-center justify-center rounded-lg py-2 text-sidebar-text transition-colors duration-150 hover:bg-white/[0.06] hover:text-white"
          title={collapsed ? 'Expand' : 'Collapse'}
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
        <div className={cn('mb-1 flex items-center gap-2.5 rounded-lg p-2', collapsed && 'justify-center')}>
          <Avatar name={displayName} src={authUser?.avatarUrl} size="sm" />
          {!collapsed && (
            <div className="min-w-0">
              <div className="truncate text-[13px] font-semibold text-white">{displayName}</div>
              <div className="truncate text-[11px] text-sidebar-text">{displayRole}</div>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => void handleLogout()}
          title="Log out"
          className={cn(
            'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13px] text-sidebar-text transition-colors duration-150 hover:bg-white/[0.06] hover:text-white',
            collapsed && 'justify-center px-2',
          )}
        >
          <LogOut size={16} className="shrink-0" />
          {!collapsed && <span>Log out</span>}
        </button>
      </div>
    </aside>
  )
}
