import { AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface ListErrorStateProps {
  message: string
  onRetry: () => void
}

export function ListErrorState({ message, onRetry }: ListErrorStateProps) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-16 text-center">
      <AlertCircle className="size-6 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">{message}</p>
      <Button variant="outline" onClick={onRetry}>
        Try again
      </Button>
    </div>
  )
}
