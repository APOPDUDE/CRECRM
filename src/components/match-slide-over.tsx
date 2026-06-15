import { useState } from 'react'
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
import { ExecutedChecklist } from '@/components/files/executed-checklist'
import { FileSection } from '@/components/files/file-section'
import { LeaseDetailsDialog } from '@/components/lease-details-dialog'
import { NotesLog } from '@/components/notes-log'
import { SourceBadge } from '@/components/source-badge'
import { ContactActions } from '@/components/contact-actions'
import { contactNameOf } from '@/hooks/use-contacts'
import { useMatch, usePromoteToTenantRep } from '@/hooks/use-matches'
import { useAuth } from '@/hooks/use-auth'
import { matchStageLabels } from '@/lib/stages'
import { formatCurrency, formatPsf } from '@/lib/format'
import { formatDate } from '@/lib/dates'
import { cn } from '@/lib/utils'

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

function ValRow({ label, value, bold }: { label: string; value: string | null; bold?: boolean }) {
  if (!value) return null
  return (
    <div className={cn('flex justify-between text-sm', bold && 'font-medium')}>
      <span className={cn(!bold && 'text-muted-foreground')}>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  )
}

export function MatchSlideOver({ matchId, open, onOpenChange }: MatchSlideOverProps) {
  const navigate = useNavigate()
  const { session } = useAuth()
  const { data: match, isLoading } = useMatch(matchId ?? undefined)
  const promote = usePromoteToTenantRep()
  const [leaseOpen, setLeaseOpen] = useState(false)

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

                  {match.tenant_contact &&
                    (match.tenant_contact.phone || match.tenant_contact.email) && (
                      <div className="-mt-1 flex items-center justify-between gap-2 text-sm">
                        <span className="truncate text-muted-foreground">
                          {contactNameOf(match.tenant_contact)}
                        </span>
                        <ContactActions
                          phone={match.tenant_contact.phone}
                          email={match.tenant_contact.email}
                        />
                      </div>
                    )}

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

                  {(match.actual_fee != null ||
                    match.executed_rate_psf != null ||
                    match.executed_price != null) && (
                    <div className="space-y-1.5 rounded-lg border p-3">
                      <p className="text-xs font-medium text-muted-foreground">Economics</p>
                      <ValRow label="Executed rate" value={formatPsf(match.executed_rate_psf)} />
                      <ValRow label="Executed price" value={formatCurrency(match.executed_price)} />
                      <ValRow
                        label="Term"
                        value={match.term_months != null ? `${match.term_months} mo` : null}
                      />
                      <ValRow label="Structure" value={match.lease_structure} />
                      <ValRow label="Fee" value={formatCurrency(match.actual_fee)} bold />
                    </div>
                  )}

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
                <div className="space-y-3">
                  {match.stage === 'executed' && (
                    <ExecutedChecklist matchId={match.id} dealType={match.listing?.deal_type ?? null} />
                  )}
                  <FileSection
                    entityType="match"
                    entityId={match.id}
                    onLeaseUploaded={() => setLeaseOpen(true)}
                  />
                </div>
              </TabsContent>

              <TabsContent value="notes" className="min-h-0 flex-1 overflow-y-auto p-4">
                <NotesLog entityType="match" entityId={match.id} />
              </TabsContent>
            </Tabs>

            <LeaseDetailsDialog open={leaseOpen} onOpenChange={setLeaseOpen} match={match} />
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
