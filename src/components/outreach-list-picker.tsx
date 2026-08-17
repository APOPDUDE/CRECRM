import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useOutreachLists, type OutreachList } from '@/hooks/use-outreach'

/**
 * The shared list picker for the three channel pages. Lists live on the outreach spine; the
 * reach column changes per channel so the number you see is the number that matters on the page
 * you are on (emailable addresses, callable numbers, mailable addresses).
 */

const REACH: Record<
  'email' | 'phone' | 'mail',
  { label: string; value: (l: OutreachList) => number | null }
> = {
  email: { label: 'Emailable', value: (l) => l.with_email },
  phone: { label: 'Callable', value: (l) => l.with_phone },
  mail: { label: 'Mailable', value: (l) => l.with_mail },
}

export function OutreachListPicker({
  channel,
  selected,
  onChange,
}: {
  channel: 'email' | 'phone' | 'mail'
  selected: string[]
  onChange: (lists: string[]) => void
}) {
  const { data: lists } = useOutreachLists()
  const reach = REACH[channel]

  return (
    <div className="space-y-2">
      <Label>Outreach lists</Label>
      <div className="max-h-64 overflow-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10" />
              <TableHead>List</TableHead>
              <TableHead className="text-right">People</TableHead>
              <TableHead className="text-right">{reach.label}</TableHead>
              {channel === 'email' ? (
                <TableHead className="text-right">Never answered</TableHead>
              ) : null}
              <TableHead className="text-right">Reached</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(lists ?? []).map((l) => (
              <TableRow key={l.list ?? ''}>
                <TableCell>
                  <Checkbox
                    checked={selected.includes(l.list ?? '')}
                    onCheckedChange={(v) =>
                      onChange(
                        v === true
                          ? [...selected, l.list ?? '']
                          : selected.filter((x) => x !== (l.list ?? '')),
                      )
                    }
                  />
                </TableCell>
                <TableCell className="text-sm">{l.list}</TableCell>
                <TableCell className="text-right font-medium tabular-nums">{l.targets}</TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {reach.value(l)}
                </TableCell>
                {channel === 'email' ? (
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {l.never_answered}
                  </TableCell>
                ) : null}
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {l.reached}
                </TableCell>
              </TableRow>
            ))}
            {!lists?.length ? (
              <TableRow>
                <TableCell
                  colSpan={channel === 'email' ? 6 : 5}
                  className="py-8 text-center text-sm text-muted-foreground"
                >
                  No lists yet — import one under Prospecting → Import list.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">
        Lists live on the outreach spine — every person imported once, pre-loaded on every channel
        they have data for. They are <strong>not</strong> contacts and stay off the property card
        until somebody actually replies.
      </p>
    </div>
  )
}
