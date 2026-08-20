import { Link } from 'react-router-dom'
import { Check, Sparkles, X } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import {
  clientLabel,
  useApproveSuggestion,
  useDismissSuggestions,
  usePropertySuggestions,
} from '@/hooks/use-suggestions'

/**
 * "Recommended for <tenant>" on the listing itself (Alex 2026-08-20) — when a new listing
 * matches a searching client, the match shows HERE, named, and the chip walks to the tenant.
 * The check starts the pursuit (same approve_suggestion the dashboard widget calls); the x
 * dismisses the pair for good.
 */
export function RecommendedForChips({ propertyId }: { propertyId: string }) {
  const { data: suggestions } = usePropertySuggestions(propertyId)
  const approve = useApproveSuggestion()
  const dismiss = useDismissSuggestions()

  if (!suggestions?.length) return null

  return (
    <>
      {suggestions.map((s) => (
        <Badge
          key={s.id}
          variant="outline"
          className="gap-1 border-violet-200 bg-violet-50 py-0.5 text-violet-700"
        >
          <Sparkles className="size-3" />
          <Link to={`/tenant-rep/${s.client?.id}`} className="hover:underline">
            Recommended for {clientLabel(s.client)}
          </Link>
          <button
            type="button"
            title="Start the pursuit"
            className="ml-0.5 hover:text-emerald-700"
            onClick={() =>
              approve.mutate(
                { id: s.id },
                {
                  onSuccess: () =>
                    toast.success(`${clientLabel(s.client)} is now pursuing this property.`),
                },
              )
            }
          >
            <Check className="size-3" />
          </button>
          <button
            type="button"
            title="Dismiss"
            className="hover:text-red-600"
            onClick={() => dismiss.mutate([s.id])}
          >
            <X className="size-3" />
          </button>
        </Badge>
      ))}
    </>
  )
}
