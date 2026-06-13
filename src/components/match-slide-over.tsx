import { useNavigate } from 'react-router-dom'
import { ArrowUpRight, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { NotesLog } from '@/components/notes-log'
import { SourceBadge } from '@/components/source-badge'
import { contactNameOf } from '@/hooks/use-contacts'
import { useMatch, usePromoteToTenantRep } from '@/hooks/use-matches'
import { useAuth } from '@/hooks/use-auth'
import { matchStageLabels } from '@/lib/stages'
import { formatDate } from '@/lib/dates'

interface MatchSlideOverProps {
  matchId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

function DateRow({ label, value }: { label: string; value: string | null }) {
  if (!value) return null
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span>{formatDate(value)}</span>
    </div>
  )
}

export function MatchSlideOver({ matchId, open, onOpenChange }: MatchSlideOverProps) {
  const navigate = useNavigate()
  const { session } = useAuth()
  const { data: match, isLoading } = useMatch(matchId ?? undefined)
  const promote = usePromoteToTenantRep()

  const tenantName =
    match?.tenant_company?.name ??
    (match?.tenant_contact ? contactNameOf(match.tenant_contact) : 'Unknown tenant')

  const goTo = (path: string) => {
    onOpenChange(false)
    navigate(path)
  }

  const handlePromote = () => {
    if (!match || !session?.user.id) return
    promote.mutate(
      { matchId: match.id, owner: session.user.id },
      {
        onSuccess: (rep) => {
          toast.success('Promoted to tenant rep')
          goTo(`/tenant-rep/${rep.id}`)
        },
        onError: () => toast.error('Could not promote to tenant rep'),
      },
    )
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        {isLoading || !match ? (
          <>
            {/* Radix requires a title for every dialog/sheet, even while loading */}
            <SheetHeader className="sr-only">
              <SheetTitle>Match</SheetTitle>
            </SheetHeader>
            <div className="p-6 text-sm text-muted-foreground">Loading…</div>
          </>
        ) : (
          <>
            <SheetHeader className="border-b">
              <SheetTitle>{tenantName}</SheetTitle>
              <SheetDescription>{match.property?.address ?? 'Match'}</SheetDescription>
            </SheetHeader>

            <Tabs defaultValue="overview" className="flex min-h-0 flex-1 flex-col">
              <div className="px-4 pt-3">
                <TabsList>
                  <TabsTrigger value="overview">Overview</TabsTrigger>
                  <TabsTrigger value="files">Files</TabsTrigger>
                  <TabsTrigger value="notes">Notes</TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="overview" className="min-h-0 flex-1 overflow-y-auto p-4">
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{matchStageLabels[match.stage]}</Badge>
                    <SourceBadge
                      source={match.source}
                      brokerName={match.broker ? contactNameOf(match.broker) : null}
                    />
                  </div>

                  <div className="space-y-1.5 rounded-lg border p-3">
                    <DateRow label="Inquiry" value={match.inquiry_date} />
                    <DateRow label="Tour" value={match.tour_date} />
                    <DateRow label="Executed" value={match.execution_date} />
                    <DateRow label="Commencement" value={match.commencement_date} />
                    <DateRow label="Lease expiration" value={match.lease_expiration} />
                    <DateRow label="PSA executed" value={match.psa_execution_date} />
                    <DateRow label="DD expiration" value={match.dd_expiration_date} />
                    <DateRow label="Closing" value={match.closing_date} />
                  </div>

                  {(match.listing_id || match.tenant_rep_id) && (
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">Boards</p>
                      {match.listing_id && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full justify-between"
                          onClick={() => goTo(`/landlord-rep/${match.listing_id}`)}
                        >
                          Property board
                          <ArrowUpRight className="size-4" />
                        </Button>
                      )}
                      {match.tenant_rep_id && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full justify-between"
                          onClick={() => goTo(`/tenant-rep/${match.tenant_rep_id}`)}
                        >
                          Tenant board
                          <ArrowUpRight className="size-4" />
                        </Button>
                      )}
                    </div>
                  )}

                  {!match.tenant_rep_id && (match.tenant_contact_id || match.tenant_company_id) && (
                    <Button
                      variant="secondary"
                      className="w-full"
                      onClick={handlePromote}
                      disabled={promote.isPending}
                    >
                      <UserPlus className="size-4" />
                      {promote.isPending ? 'Promoting…' : 'Promote to tenant rep'}
                    </Button>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="files" className="min-h-0 flex-1 overflow-y-auto p-4">
                <p className="text-sm text-muted-foreground">
                  File uploads and the executed-document checklist arrive in Phase 6.
                </p>
              </TabsContent>

              <TabsContent value="notes" className="min-h-0 flex-1 overflow-y-auto p-4">
                <NotesLog entityType="match" entityId={match.id} />
              </TabsContent>
            </Tabs>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
