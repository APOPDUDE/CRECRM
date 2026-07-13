import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { paymentRungMessage, usePaymentCheckAnswer } from '@/hooks/use-tasks'
import type { Tables } from '@/lib/database.types'

/**
 * The two-answer control on an open "Payment received?" reminder — used on the dashboard
 * Upcoming-tasks widget and the Tasks page. Received ends the reminder cycle; Not received
 * completes this check and puts the next one on the calendar two weeks out.
 */
export function PaymentCheckActions({ task }: { task: Tables<'tasks'> }) {
  const answer = usePaymentCheckAnswer()
  if (task.source !== 'payment_check' || task.status !== 'open' || !task.pursuit_id) return null
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <Button
        size="sm"
        className="h-7"
        disabled={answer.isPending}
        onClick={(e) => {
          e.stopPropagation()
          answer.mutate(
            { task, received: true },
            {
              onSuccess: () => toast.success('Payment marked received'),
              onError: () => toast.error('Could not update payment'),
            },
          )
        }}
      >
        Received
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="h-7 text-muted-foreground"
        disabled={answer.isPending}
        onClick={(e) => {
          e.stopPropagation()
          answer.mutate(
            { task, received: false },
            {
              onSuccess: (rung) => toast.success(paymentRungMessage(rung)),
              onError: () => toast.error('Could not set reminder'),
            },
          )
        }}
      >
        Not received
      </Button>
    </div>
  )
}
