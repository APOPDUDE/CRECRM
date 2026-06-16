import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Enums, Tables, TablesInsert } from '@/lib/database.types'
import type { ParentType } from '@/hooks/use-notes'

export type FileRow = Tables<'files'>
type FileCategory = Enums<'file_category'>

const BUCKET = 'deal-files'
const parentColumn = (t: ParentType) =>
  t === 'client' ? 'client_id' : t === 'listing' ? 'listing_id' : 'pursuit_id'
const filesKey = (parentType: ParentType, parentId: string) => ['files', parentType, parentId]

export const fileCategoryLabels: Record<FileCategory, string> = {
  listing_agreement: 'Listing agreement',
  rep_agreement: 'Rep agreement',
  marketing: 'Marketing',
  loi: 'LOI',
  lease: 'Lease',
  psa: 'PSA',
  coi_insurance: 'COI / Insurance',
  guarantee: 'Guarantee',
  financials: 'Financials',
  invoice: 'Invoice',
  other: 'Other',
}

export function useFiles(parentType: ParentType, parentId: string | undefined) {
  return useQuery({
    queryKey: filesKey(parentType, parentId ?? ''),
    enabled: !!parentId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('files')
        .select('*')
        .eq(parentColumn(parentType), parentId!)
        .order('uploaded_at', { ascending: false })
      if (error) throw error
      return data
    },
  })
}

export interface UploadResult {
  total: number
  failed: string[]
}

export function useUploadFiles(parentType: ParentType, parentId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      files,
      category,
    }: {
      files: File[]
      category: FileCategory
    }): Promise<UploadResult> => {
      const failed: string[] = []
      for (const file of files) {
        try {
          const path = `${parentType}/${parentId}/${crypto.randomUUID()}-${file.name}`
          const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file)
          if (uploadError) throw uploadError
          const { error: insertError } = await supabase.from('files').insert({
            [parentColumn(parentType)]: parentId,
            category,
            file_name: file.name,
            storage_path: path,
            file_size: file.size,
            mime_type: file.type || null,
          } as TablesInsert<'files'>)
          if (insertError) {
            await supabase.storage.from(BUCKET).remove([path])
            throw insertError
          }
        } catch {
          failed.push(file.name)
        }
      }
      return { total: files.length, failed }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: filesKey(parentType, parentId) }),
  })
}

export function useRenameFile(parentType: ParentType, parentId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const { error } = await supabase.from('files').update({ file_name: name }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: filesKey(parentType, parentId) }),
  })
}

export function useDeleteFile(parentType: ParentType, parentId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (file: FileRow) => {
      await supabase.storage.from(BUCKET).remove([file.storage_path])
      const { error } = await supabase.from('files').delete().eq('id', file.id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: filesKey(parentType, parentId) }),
  })
}

/** Signed URL for a private file; pass downloadName to force a download. */
export async function signedUrl(
  storagePath: string,
  downloadName?: string,
  expiresIn = 300,
): Promise<string> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, expiresIn, downloadName ? { download: downloadName } : undefined)
  if (error || !data) throw error ?? new Error('Could not sign URL')
  return data.signedUrl
}
