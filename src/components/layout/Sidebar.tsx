import { NavLink } from 'react-router-dom'
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
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/store/uiStore'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { HmsLogo } from '@/components/HmsLogo'
import { useAuthStore } from '@/store/authStore'
import { isCompanyAdmin, roleLabel } from '@/lib/roles'
import { APP_NAME } from '@/lib/branding'

type NavItem = {
  to: string
  icon: typeof LayoutDashboard
  label: string
  end?: boolean
  badge?: string
  badgeColor?: 'amber' | 'green' | 'blue'
}

export function Sidebar() {
  const collapsed = useUIStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)
  const authUser = useAuthStore((s) => s.user)
  const displayName = authUser?.name ?? 'User'
  const isAdmin = isCompanyAdmin(authUser?.role)
  const displayRole = roleLabel(authUser?.role)

  const adminNav: { label: string; items: NavItem[] }[] = [
    {
      label: 'MAIN',
      items: [
        { to: '/', icon: LayoutDashboard, label: 'Dashboard', end: true },
        { to: '/help', icon: BookOpen, label: 'How it works' },
        { to: '/reports', icon: BarChart3, label: 'Reports' },
      ],
    },
    {
      label: 'SERVICE',
      items: [
        { to: '/tickets', icon: Ticket, label: 'Service tickets' },
        { to: '/amc', icon: Shield, label: 'AMC / Non-AMC' },
        { to: '/stamping', icon: Stamp, label: 'Stamping' },
        { to: '/contacts', icon: Users, label: 'Customers' },
        { to: '/activities', icon: Phone, label: 'Activities' },
      ],
    },
    {
      label: 'SALES',
      items: [{ to: '/sale-tracking', icon: UserPlus, label: 'Sale tracking' }],
    },
    {
      label: 'ERP',
      items: [
        { to: '/erp/products', icon: Package, label: 'Products' },
        { to: '/erp/inventory', icon: Warehouse, label: 'Inventory' },
        { to: '/erp/purchase-orders', icon: ShoppingCart, label: 'Purchase Orders' },
        { to: '/erp/invoices', icon: FileText, label: 'Invoices' },
      ],
    },
    {
      label: 'MORE',
      items: [
        { to: '/emails', icon: Mail, label: 'Emails' },
        { to: '/settings', icon: Settings, label: 'Settings' },
        { to: '/users', icon: UserCog, label: 'Users & Roles' },
      ],
    },
  ]

  const employeeNav: { label: string; items: NavItem[] }[] = [
    {
      label: 'MY WORK',
      items: [
        { to: '/', icon: LayoutDashboard, label: 'Home', end: true },
        { to: '/tickets', icon: Ticket, label: 'My Tickets' },
        { to: '/amc', icon: Shield, label: 'AMC / Non-AMC' },
        { to: '/stamping', icon: Stamp, label: 'Stamping' },
        { to: '/my-tasks', icon: CheckSquare, label: 'My Tasks' },
        { to: '/help', icon: BookOpen, label: 'How it works' },
      ],
    },
    {
      label: 'CUSTOMERS',
      items: [{ to: '/contacts', icon: Users, label: 'Customers' }],
    },
    {
      label: 'SALES',
      items: [{ to: '/sale-tracking', icon: UserPlus, label: 'My sales' }],
    },
    {
      label: 'ACCOUNT',
      items: [{ to: '/settings', icon: Settings, label: 'My Profile' }],
    },
  ]

  const navSections = isAdmin ? adminNav : employeeNav

  return (
    <aside
      className={cn(
        'flex h-full flex-col bg-sidebar-bg text-sidebar-text transition-all duration-150',
        collapsed ? 'w-16' : 'w-60',
      )}
    >
      <div className={cn('flex h-14 items-center border-b border-white/10 px-3', collapsed && 'justify-center px-2')}>
        {collapsed ? (
          <img
            src="/hms-logo.png"
            alt={APP_NAME}
            className="h-8 w-auto max-w-[48px] object-contain object-left"
            draggable={false}
          />
        ) : (
          <div className="min-w-0 rounded-md bg-[#0a0a0a] px-2 py-2">
            <HmsLogo size="sm" />
          </div>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto py-3">
        {!collapsed && !isAdmin ? (
          <div className="mb-3 mx-2 rounded-[8px] border border-white/10 bg-white/5 px-3 py-2">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-sky-300">Service desk</div>
            <div className="mt-0.5 text-xs text-slate-300">Tickets first — look up customers, complete service</div>
          </div>
        ) : null}
        {navSections.map((section) => (
          <div key={section.label} className="mb-4">
            {!collapsed && (
              <div className="mb-1 px-4 text-[10px] font-semibold tracking-wider text-slate-500">
                {section.label}
              </div>
            )}
            <ul className="space-y-0.5 px-2">
              {section.items.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.end}
                    title={collapsed ? item.label : undefined}
                    className={({ isActive }) =>
                      cn(
                        'group relative flex items-center gap-3 rounded-[6px] px-3 py-2 text-sm transition-all duration-150',
                        collapsed && 'justify-center px-2',
                        isActive
                          ? 'bg-sidebar-active/20 text-white before:absolute before:left-0 before:top-1 before:bottom-1 before:w-[3px] before:rounded-r before:bg-sidebar-active'
                          : 'hover:bg-white/5 hover:text-slate-200',
                      )
                    }
                  >
                    <item.icon size={18} className="shrink-0" />
                    {!collapsed && (
                      <>
                        <span className="flex-1 truncate">{item.label}</span>
                        {item.badge && (
                          <Badge color={item.badgeColor ?? 'amber'} className="text-[9px] px-1.5">
                            {item.badge}
                          </Badge>
                        )}
                      </>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-white/10 p-2">
        <button
          onClick={toggleSidebar}
          className="mb-2 flex w-full items-center justify-center rounded-[6px] py-2 text-sidebar-text hover:bg-white/5 transition-colors duration-150"
          title={collapsed ? 'Expand' : 'Collapse'}
        >
          {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </button>
        <div className={cn('flex items-center gap-3 rounded-[6px] p-2', collapsed && 'justify-center')}>
          <Avatar name={displayName} src={authUser?.avatarUrl} size="sm" />
          {!collapsed && (
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-white">{displayName}</div>
              <div className="truncate text-xs text-sidebar-text">{displayRole}</div>
            </div>
          )}
        </div>
      </div>
    </aside>
  )
}
