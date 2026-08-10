import { cn, getInitials } from '@/lib/utils'
import { assetUrl } from '@/lib/formValidation'

interface AvatarProps {
  name: string
  src?: string | null
  size?: 'sm' | 'md' | 'lg' | 'xl'
  className?: string
}

const sizes = {
  sm: 'h-6 w-6 text-[10px]',
  md: 'h-8 w-8 text-xs',
  lg: 'h-10 w-10 text-sm',
  xl: 'h-16 w-16 text-lg',
}

const colors = [
  'bg-blue-500',
  'bg-emerald-500',
  'bg-violet-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-cyan-500',
  'bg-indigo-500',
  'bg-teal-500',
]

export function Avatar({ name, src, size = 'md', className }: AvatarProps) {
  const colorIndex = name.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % colors.length
  const url = assetUrl(src)
  if (url) {
    return (
      <img
        src={url}
        alt={name}
        title={name}
        className={cn('inline-block shrink-0 rounded-full object-cover', sizes[size], className)}
      />
    )
  }
  return (
    <div
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white',
        sizes[size],
        colors[colorIndex],
        className,
      )}
      title={name}
    >
      {getInitials(name)}
    </div>
  )
}
