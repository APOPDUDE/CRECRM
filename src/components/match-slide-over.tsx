import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowUpRight, Trash2, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConfirmDeleteDialog } from '@/components/confirm-delete-dialog'
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
import { InlineEditField } from '@/components/inline-edit-field'
import { LeaseDetailsDialog } from '@/components/lease-details-dialog'
import { NotesLog } from '@/components/notes-log'
import { SourceBadge } from '@/components/source-badge'
import { ContactActions } from '@/components/contact-actions'
import { contactNameOf } from '@/hooks/use-contacts'
import { useDeleteMatch, useMatch, usePromoteToTenantRep } from '@/hooks/use-matches'
import { useProperty, useUpdateProperty } from '@/hooks/use-properties'
import { usePursuitUnits, unitSizeLabel } from '@/hooks/use-units'
import { pursuitStageLabels } from '@/lib/stages'
import { formatCurrency, formatPsf } from '@/lib/format'
import { formatDate, formatTimeOfDay } from '@/lib/dates'

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
  const { data: match, isLoading } = useMatch(matchId ?? undefined)
  const { data: pursuitUnits = [] } = usePursuitUnits(matchId ?? undefined)
  // Full property row (the embedded pick is narrow) — for the editable description.
  const { data: property } = useProperty(match?.property_id)
  const updateProperty = useUpdateProperty()
  const promote = usePromoteToTenantRep()
  const deleteMatch = useDeleteMatch()
  const [leaseOpen, setLeaseOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const saveDescription = async (v: string | number | boolean | null) => {
    if (!match) return
    try {
      await updateProperty.mutateAsync({
        id: match.property_id,
        description: v == null ? null : String(v),
      })
      toast.success('Description saved')
    } catch {
      toast.error('Could not save description')
    }
  }

  const handleDelete = () => {
    if (!match) return
    deleteMatch.mutate(match.id, {
      onSuccess: () => {
        toast.success('Removed from board')
        setConfirmDelete(false)
        onOpenChange(false)
      },
      onError: () => toast.error('Could not remove it'),
    })
  }

  const tenantName =
    match?.tenant_company?.name ??
    (match?.tenant_contact ? contactNameOf(match.tenant_contact) : 'Unknown tenant')

  const goTo = (path: string) => {
    onOpenChange(false)
    navigate(path)
  }

  const handlePromote = () => {
    if (!match) return
    promote.mutate(
      { clientId: match.client_id },
      {
        onSuccess: (client) => {
          toast.success('Promoted to active client')
          goTo(`/tenant-rep/${client.id}`)
        },
        onError: () => toast.error('Could not promote client'),
      },
    )
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        {isLoading || !match ? (
          <>
            <SheetHeader className="sr-only">
              <SheetTitle>Pursuit</SheetTitle>
            </SheetHeader>
            <div className="p-6 text-sm text-muted-foreground">Loading…</div>
          </>
        ) : (
          <>
            <SheetHeader className="border-b">
              <SheetTitle>{tenantName}</SheetTitle>
              <SheetDescription>{match.property?.address ?? 'Pursuit'}</SheetDescription>
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
                    <Badge variant="secondary">{pursuitStageLabels[match.stage]}</Badge>
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
                    {match.tour_date && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Tour</span>
                        <span>
                          {formatDate(match.tour_date)}
                          {match.tour_time ? ` · ${formatTimeOfDay(match.tour_time)}` : ''}
                        </span>
                      </div>
                    )}
                    <DateRow label="Executed" value={match.executed_date} />
                    {match.actual_fee != null && (
                      <div className="flex justify-between text-sm font-medium">
                        <span>Fee</span>
                        <span className="tabular-nums">{formatCurrency(match.actual_fee)}</span>
                      </div>
                    )}
                  </div>

                  {/* Property description — jot the broker call notes here; the same text
                      shows on the prospect preview and the property page. */}
                  <div className="rounded-lg border p-3">
                    <InlineEditField
                      label="Property description"
                      value={property?.description ?? null}
                      kind="text"
                      multiline
                      onSave={saveDescription}
                    />
                  </div>

                  {pursuitUnits.length > 0 && (
                    <div className="space-y-1.5 rounded-lg border p-3">
                      <p className="text-xs font-medium text-muted-foreground">Units inquired on</p>
                      {pursuitUnits.map((u) => (
                        <div key={u.id} className="flex justify-between gap-3 text-sm">
                          <span className="truncate">{u.label || unitSizeLabel(u)}</span>
                          <span className="shrink-0 text-muted-foreground">
                            {[
                              u.label ? unitSizeLabel(u) : null,
                              u.asking_rate_psf != null ? formatPsf(u.asking_rate_psf) : null,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">Boards</p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full justify-between"
                      onClick={() => goTo(`/properties/${match.property_id}`)}
                    >
                      Property page
                      <ArrowUpRight className="size-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full justify-between"
                      onClick={() => goTo(`/tenant-rep/${match.client_id}`)}
                    >
                      Tenant board
                      <ArrowUpRight className="size-4" />
                    </Button>
                  </div>

                  {match.client?.status === 'prospect' && (
                    <Button
                      variant="secondary"
                      className="w-full"
                      onClick={handlePromote}
                      disabled={promote.isPending}
                    >
                      <UserPlus className="size-4" />
                      {promote.isPending ? 'Promoting…' : 'Promote to active client'}
                    </Button>
                  )}

                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full text-destructive hover:text-destructive"
                    onClick={() => setConfirmDelete(true)}
                  >
                    <Trash2 className="size-4" />
                    Remove from board
                  </Button>
                </div>
              </TabsContent>

              <TabsContent value="files" className="min-h-0 flex-1 overflow-y-auto p-4">
                <div className="space-y-3">
                  {match.stage === 'executed' && (
                    <ExecutedChecklist matchId={match.id} dealType={match.client?.deal_type ?? null} />
                  )}
                  <FileSection
                    parentType="pursuit"
                    parentId={match.id}
                    onLeaseUploaded={() => setLeaseOpen(true)}
                  />
                </div>
              </TabsContent>

              <TabsContent value="notes" className="min-h-0 flex-1 overflow-y-auto p-4">
                <NotesLog parentType="pursuit" parentId={match.id} />
              </TabsContent>
            </Tabs>

            <LeaseDetailsDialog open={leaseOpen} onOpenChange={setLeaseOpen} match={match} />
            <ConfirmDeleteDialog
              open={confirmDelete}
              onOpenChange={setConfirmDelete}
              title="Remove from board?"
              description={`This removes ${match.property?.address ?? 'this property'} from the board. The property record itself is kept.`}
              pending={deleteMatch.isPending}
              onConfirm={handleDelete}
            />
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
