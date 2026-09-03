import { useState } from 'react'
import { Package } from 'lucide-react'
import { cn } from '@/lib/utils'
import { assetUrl } from '@/lib/formValidation'

type ProductImageProps = {
  src?: string | null
  alt?: string
  className?: string
  fallbackClassName?: string
  iconSize?: number
}

export function ProductImage({
  src,
  alt = '',
  className,
  fallbackClassName,
  iconSize = 14,
}: ProductImageProps) {
  const [broken, setBroken] = useState(false)
  const url = assetUrl(src)

  if (!url || broken) {
    return (
      <div
        className={cn(
          'flex items-center justify-center rounded bg-muted text-text-secondary',
          fallbackClassName ?? className,
        )}
      >
        <Package size={iconSize} />
      </div>
    )
  }

  return (
    <img
      src={url}
      alt={alt}
      className={className}
      draggable={false}
      onError={() => setBroken(true)}
    />
  )
}
