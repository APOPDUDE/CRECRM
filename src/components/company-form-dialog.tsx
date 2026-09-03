import { useState } from 'react'
import { useResetOn } from '@/hooks/use-reset-on'
import type { FormEvent } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useCreateCompany, useUpdateCompany } from '@/hooks/use-companies'
import type { Company } from '@/hooks/use-companies'
import type { Enums } from '@/lib/database.types'
import { friendlyDbError } from '@/lib/db-errors'
import { companyTypeLabels } from '@/lib/labels'

interface CompanyFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** When set, the dialog edits this company; otherwise it creates a new one. */
  company?: Company | null
  /** Default company type when creating a new company. */
  defaultType?: Enums<'company_type'>
  /** Called with the new company id right before the dialog closes (create only). */
  onCreated?: (id: string) => void
}

export function CompanyFormDialog({
  open,
  onOpenChange,
  company,
  defaultType = 'other',
  onCreated,
}: CompanyFormDialogProps) {
  const createCompany = useCreateCompany()
  const updateCompany = useUpdateCompany()
  const pending = createCompany.isPending || updateCompany.isPending

  const [name, setName] = useState('')
  const [type, setType] = useState<Enums<'company_type'>>(defaultType)
  const [phone, setPhone] = useState('')
  const [website, setWebsite] = useState('')
  const [industry, setIndustry] = useState('')
  const [notes, setNotes] = useState('')
  const [employees, setEmployees] = useState('')
  const [revenue, setRevenue] = useState('')
  const [naics, setNaics] = useState('')
  const [sic, setSic] = useState('')

  useResetOn([open, company, defaultType], () => {
    if (open) {
      setName(company?.name ?? '')
      setType(company?.type ?? defaultType)
      setPhone(company?.phone ?? '')
      setWebsite(company?.website ?? '')
      setIndustry(company?.industry ?? '')
      setNotes(company?.notes ?? '')
      setEmployees(company?.employee_count?.toString() ?? '')
      setRevenue(company?.annual_revenue?.toString() ?? '')
      setNaics(company?.naics ?? '')
      setSic(company?.sic ?? '')
    }
  })

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    const values = {
      name: name.trim(),
      type,
      phone: phone.trim() || null,
      website: website.trim() || null,
      industry: industry.trim() || null,
      notes: notes.trim() || null,
      employee_count: employees.trim() === '' ? null : Number(employees),
      annual_revenue: revenue.trim() === '' ? null : Number(revenue),
      naics: naics.trim() || null,
      sic: sic.trim() || null,
    }
    const onError = (error: unknown) =>
      toast.error(friendlyDbError(error, 'Could not save company'))

    if (company) {
      updateCompany.mutate(
        { id: company.id, ...values },
        {
          onSuccess: () => {
            toast.success('Company updated')
            onOpenChange(false)
          },
          onError,
        },
      )
    } else {
      createCompany.mutate(values, {
        onSuccess: (created) => {
          toast.success('Company created')
          onCreated?.(created.id)
          onOpenChange(false)
        },
        onError,
      })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{company ? 'Edit company' : 'Add company'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="company-name">Name</Label>
            <Input
              id="company-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="company-type">Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as Enums<'company_type'>)}>
              <SelectTrigger id="company-type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(companyTypeLabels).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="company-phone">Phone</Label>
              <Input
                id="company-phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="company-website">Website</Label>
              <Input
                id="company-website"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                placeholder="example.com"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="company-industry">Industry</Label>
            <Input
              id="company-industry"
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              placeholder="e.g. Logistics, Food distribution"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="company-employees">Employees</Label>
              <Input
                id="company-employees"
                type="number"
                value={employees}
                onChange={(e) => setEmployees(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="company-revenue">Annual revenue $</Label>
              <Input
                id="company-revenue"
                type="number"
                value={revenue}
                onChange={(e) => setRevenue(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="company-naics">NAICS</Label>
              <Input id="company-naics" value={naics} onChange={(e) => setNaics(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="company-sic">SIC</Label>
              <Input id="company-sic" value={sic} onChange={(e) => setSic(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="company-notes">Notes</Label>
            <Textarea
              id="company-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !name.trim()}>
              {pending ? 'Saving…' : company ? 'Save changes' : 'Add company'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
