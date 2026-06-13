import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Enums, Tables } from '@/lib/database.types'

export type FileRow = Tables<'files'>
type NoteEntity = Enums<'note_entity'>
type FileCategory = Enums<'file_category'>

const BUCKET = 'deal-files'
const filesKey = (entityType: NoteEntity, entityId: string) => ['files', entityType, entityId]

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
  other: 'Other',
}

export function useFiles(entityType: NoteEntity, entityId: string | undefined) {
  return useQuery({
    queryKey: filesKey(entityType, entityId ?? ''),
    enabled: !!entityId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('files')
        .select('*')
        .eq('entity_type', entityType)
        .eq('entity_id', entityId!)
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

export function useUploadFiles(entityType: NoteEntity, entityId: string) {
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
      // each file commits independently; one failure doesn't abort the rest
      for (const file of files) {
        try {
          const path = `${entityType}/${entityId}/${crypto.randomUUID()}-${file.name}`
          const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file)
          if (uploadError) throw uploadError
          const { error: insertError } = await supabase.from('files').insert({
            entity_type: entityType,
            entity_id: entityId,
            category,
            file_name: file.name,
            storage_path: path,
            file_size: file.size,
            mime_type: file.type || null,
          })
          if (insertError) {
            // roll back the orphaned storage object if the row insert fails
            await supabase.storage.from(BUCKET).remove([path])
            throw insertError
          }
        } catch {
          failed.push(file.name)
        }
      }
      return { total: files.length, failed }
    },
    // always refresh so successfully-committed files surface, even on partial failure
    onSettled: () => queryClient.invalidateQueries({ queryKey: filesKey(entityType, entityId) }),
  })
}

export function useRenameFile(entityType: NoteEntity, entityId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const { error } = await supabase.from('files').update({ file_name: name }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: filesKey(entityType, entityId) }),
  })
}

export function useDeleteFile(entityType: NoteEntity, entityId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (file: FileRow) => {
      await supabase.storage.from(BUCKET).remove([file.storage_path])
      const { error } = await supabase.from('files').delete().eq('id', file.id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: filesKey(entityType, entityId) }),
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
