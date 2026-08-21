import { NavLink } from 'react-router-dom'
import { useIsVa } from '@/hooks/use-is-va'
import { cn } from '@/lib/utils'

/**
 * Sub-navigation shared by the texting pages. The VA sees the two consoles they work
 * (Replies, Today's batch); Campaigns and Settings are Alex-only — hidden here and
 * guarded again at the route.
 */
export function TextingNav() {
  const isVa = useIsVa()
  const items = [
    { to: '/texting', label: 'Replies', end: true },
    { to: '/texting/send', label: "Today's batch", end: false },
    ...(isVa
      ? []
      : [
          { to: '/texting/campaigns', label: 'Campaigns', end: false },
          { to: '/texting/settings', label: 'Settings', end: false },
        ]),
  ]

  return (
    <div className="flex w-fit items-center gap-1 rounded-lg bg-muted p-1">
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) =>
            cn(
              'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              isActive
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )
          }
        >
          {item.label}
        </NavLink>
      ))}
    </div>
  )
}
