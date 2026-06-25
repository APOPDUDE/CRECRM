import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Enums, Tables, TablesInsert } from '@/lib/database.types'
import type { ParentType } from '@/hooks/use-notes'

export type FileRow = Tables<'files'>
type FileCategory = Enums<'file_category'>

/** Files attach to a deal entity OR directly to a property. */
export type FileParentType = ParentType | 'property'

const BUCKET = 'deal-files'
const parentColumn = (t: FileParentType) =>
  t === 'client'
    ? 'client_id'
    : t === 'listing'
      ? 'listing_id'
      : t === 'property'
        ? 'property_id'
        : 'pursuit_id'
const filesKey = (parentType: FileParentType, parentId: string) => ['files', parentType, parentId]

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

export function useFiles(parentType: FileParentType, parentId: string | undefined) {
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

/**
 * The human-readable folder a file should live in (mirrors the kanban tree), resolved server-side by
 * the fs_entity_path RPC so the app, the Mac reconciler, and any DB reader agree on one path scheme.
 * Falls back to the legacy `<type>/<id>` prefix for entities with no folder yet (inactive/closed/unrepped).
 */
async function resolveFolder(parentType: FileParentType, parentId: string): Promise<string> {
  const { data, error } = await supabase.rpc('fs_entity_path', { p_type: parentType, p_id: parentId })
  if (error) throw error
  return data || `${parentType}/${parentId}`
}

/**
 * Upload into `folder`, de-colliding same-name files the way Finder does (`name (2).pdf`) so we keep clean,
 * UUID-free object keys. Returns the final storage path.
 */
async function uploadDeduped(folder: string, file: File): Promise<string> {
  const dot = file.name.lastIndexOf('.')
  const base = dot > 0 ? file.name.slice(0, dot) : file.name
  const ext = dot > 0 ? file.name.slice(dot) : ''
  for (let n = 1; n <= 50; n++) {
    const path = `${folder}/${n === 1 ? base : `${base} (${n})`}${ext}`
    const { error } = await supabase.storage.from(BUCKET).upload(path, file)
    if (!error) return path
    const status = (error as { statusCode?: string }).statusCode
    if (status === '409' || /exist|duplicate/i.test(error.message)) continue // name taken, try next suffix
    throw error
  }
  throw new Error('Could not find a free filename')
}

export function useUploadFiles(parentType: FileParentType, parentId: string) {
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
          const folder = await resolveFolder(parentType, parentId)
          const path = await uploadDeduped(folder, file)
          // Upsert (not insert) so the app and the reconciler can never collide on the storage_path unique key.
          const { error: insertError } = await supabase.from('files').upsert(
            {
              [parentColumn(parentType)]: parentId,
              category,
              file_name: file.name,
              storage_path: path,
              file_size: file.size,
              mime_type: file.type || null,
            } as TablesInsert<'files'>,
            { onConflict: 'storage_path' },
          )
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

export function useRenameFile(parentType: FileParentType, parentId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const { error } = await supabase.from('files').update({ file_name: name }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: filesKey(parentType, parentId) }),
  })
}

export function useDeleteFile(parentType: FileParentType, parentId: string) {
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
