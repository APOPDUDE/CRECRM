import { useMemo, useRef, useState } from 'react'
import {
  ChevronLeft,
  Download,
  Eye,
  FileText,
  Folder,
  FolderInput,
  FolderPlus,
  MoreHorizontal,
  Pencil,
  Trash2,
  Upload,
} from 'lucide-react'
import JSZip from 'jszip'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ConfirmDeleteDialog } from '@/components/confirm-delete-dialog'
import {
  fileCategoryLabels,
  fileSubfolder,
  signedUrl,
  useDeleteFile,
  useEntityBasePath,
  useFiles,
  useMoveFile,
  useRenameFile,
  useUploadFiles,
} from '@/hooks/use-files'
import type { FileRow, FileParentType } from '@/hooks/use-files'
import type { Enums } from '@/lib/database.types'
import { friendlyDbError } from '@/lib/db-errors'
import { formatBytes } from '@/lib/format'
import { formatDate } from '@/lib/dates'
import { cn } from '@/lib/utils'

type FileCategory = Enums<'file_category'>

const isPreviewable = (mime: string | null) =>
  !!mime && (mime.startsWith('image/') || mime === 'application/pdf')

interface FileSectionProps {
  parentType: FileParentType
  parentId: string
  defaultCategory?: FileCategory
  /** Fires after a lease/PSA file uploads successfully (used to prompt for lease dates). */
  onLeaseUploaded?: () => void
}

export function FileSection({
  parentType,
  parentId,
  defaultCategory = 'other',
  onLeaseUploaded,
}: FileSectionProps) {
  const { data: files = [], isLoading } = useFiles(parentType, parentId)
  const { data: basePath } = useEntityBasePath(parentType, parentId)
  const upload = useUploadFiles(parentType, parentId)
  const rename = useRenameFile(parentType, parentId)
  const remove = useDeleteFile(parentType, parentId)
  const move = useMoveFile(parentType, parentId)

  const inputRef = useRef<HTMLInputElement>(null)
  const [category, setCategory] = useState<FileCategory>(defaultCategory)
  const [dragOver, setDragOver] = useState(false)
  const [preview, setPreview] = useState<{ url: string; file: FileRow } | null>(null)
  const [renaming, setRenaming] = useState<FileRow | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [deleting, setDeleting] = useState<FileRow | null>(null)
  const [zipping, setZipping] = useState(false)

  // Sub-folder navigation ('' = the entity's file root). Folders mirror the
  // Finder-synced storage layout; a session-created folder exists on screen until
  // its first upload materializes it in storage.
  const [folder, setFolder] = useState('')
  const [sessionFolders, setSessionFolders] = useState<string[]>([])
  const [newFolderOpen, setNewFolderOpen] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [moving, setMoving] = useState<FileRow | null>(null)

  const folderOf = (f: FileRow) => fileSubfolder(f, basePath)

  /** All known folder paths (from files + created this session). */
  const allFolders = useMemo(() => {
    const set = new Set<string>(sessionFolders)
    for (const f of files) {
      const path = fileSubfolder(f, basePath)
      // register every ancestor so nested paths navigate cleanly
      const parts = path.split('/').filter(Boolean)
      for (let i = 1; i <= parts.length; i++) set.add(parts.slice(0, i).join('/'))
    }
    return set
  }, [files, basePath, sessionFolders])

  /** Direct child folders of the current folder. */
  const childFolders = useMemo(() => {
    const prefix = folder ? folder + '/' : ''
    const children = new Set<string>()
    for (const path of allFolders) {
      if (path === folder || !path.startsWith(prefix)) continue
      const rest = path.slice(prefix.length)
      if (rest) children.add(rest.split('/')[0])
    }
    return [...children].sort((a, b) => a.localeCompare(b))
  }, [allFolders, folder])

  const visibleFiles = files.filter((f) => folderOf(f) === folder)
  const countIn = (child: string) => {
    const full = folder ? `${folder}/${child}` : child
    return files.filter((f) => {
      const p = folderOf(f)
      return p === full || p.startsWith(full + '/')
    }).length
  }

  const createFolder = () => {
    const name = newFolderName.trim().replace(/[/\\]/g, '-')
    if (!name) return
    const full = folder ? `${folder}/${name}` : name
    setSessionFolders((s) => (s.includes(full) ? s : [...s, full]))
    setFolder(full)
    setNewFolderOpen(false)
    setNewFolderName('')
  }

  const moveTo = (target: string) => {
    if (!moving || !basePath) return
    move.mutate(
      { file: moving, subfolder: target, basePath },
      {
        onSuccess: () => {
          toast.success(target ? `Moved to ${target.split('/').pop()}` : 'Moved to files root')
          setMoving(null)
        },
        onError: () => toast.error('Could not move file'),
      },
    )
  }

  const doUpload = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return
    upload.mutate(
      { files: Array.from(fileList), category, subfolder: folder },
      {
        onSuccess: (res) => {
          if (res.failed.length === 0) {
            toast.success(res.total === 1 ? 'Uploaded' : `Uploaded ${res.total} files`)
          } else {
            toast.error(`${res.failed.length} of ${res.total} file(s) failed to upload`)
          }
          // prompt for lease dates when a lease/PSA doc lands
          if ((category === 'lease' || category === 'psa') && res.failed.length < res.total) {
            onLeaseUploaded?.()
          }
        },
        onError: (e) => toast.error(friendlyDbError(e, 'Upload failed')),
      },
    )
  }

  const openPreview = async (file: FileRow) => {
    try {
      // longer-lived URL so the preview doesn't expire while open
      setPreview({ url: await signedUrl(file.storage_path, undefined, 3600), file })
    } catch {
      toast.error('Could not open file')
    }
  }

  const download = async (file: FileRow) => {
    try {
      const url = await signedUrl(file.storage_path, file.file_name)
      // an anchor click isn't blocked by popup blockers the way window.open(after await) is on iOS/Safari
      const a = document.createElement('a')
      a.href = url
      a.rel = 'noopener'
      a.download = file.file_name
      document.body.appendChild(a)
      a.click()
      a.remove()
    } catch {
      toast.error('Could not download file')
    }
  }

  const downloadAll = async () => {
    setZipping(true)
    try {
      const zip = new JSZip()
      const usedNames = new Map<string, number>()
      const failed: string[] = []
      for (const file of files) {
        try {
          const res = await fetch(await signedUrl(file.storage_path))
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          // de-dupe entry names so same-named files don't overwrite each other in the zip
          let name = file.file_name
          const seen = usedNames.get(name)
          if (seen != null) {
            const dot = name.lastIndexOf('.')
            const suffix = ` (${seen + 1})`
            name = dot > 0 ? name.slice(0, dot) + suffix + name.slice(dot) : name + suffix
            usedNames.set(file.file_name, seen + 1)
          } else {
            usedNames.set(file.file_name, 1)
          }
          zip.file(name, await res.blob())
        } catch {
          failed.push(file.file_name)
        }
      }
      const blob = await zip.generateAsync({ type: 'blob' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${parentType}-files.zip`
      a.click()
      URL.revokeObjectURL(url)
      if (failed.length > 0) toast.error(`${failed.length} file(s) couldn't be added to the zip`)
    } catch {
      toast.error('Could not build zip')
    } finally {
      setZipping(false)
    }
  }

  const submitRename = () => {
    if (!renaming) return
    const name = renameValue.trim()
    if (!name) return
    rename.mutate(
      { id: renaming.id, name },
      {
        onSuccess: () => {
          toast.success('Renamed')
          setRenaming(null)
        },
        onError: () => toast.error('Could not rename'),
      },
    )
  }

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          doUpload(e.dataTransfer.files)
        }}
        className={cn(
          'flex flex-col items-center gap-2 rounded-lg border border-dashed p-4 text-center transition-colors',
          dragOver && 'border-primary bg-primary/5',
        )}
      >
        <Upload className="size-5 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">Drag files here, or</p>
        <div className="flex w-full items-center gap-2">
          <Select value={category} onValueChange={(v) => setCategory(v as FileCategory)}>
            <SelectTrigger size="sm" className="flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(fileCategoryLabels).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={upload.isPending}
            onClick={() => inputRef.current?.click()}
          >
            {upload.isPending ? 'Uploading…' : 'Choose'}
          </Button>
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          data-file-input
          className="hidden"
          onChange={(e) => {
            doUpload(e.target.files)
            e.target.value = ''
          }}
        />
      </div>

      {files.length > 1 && (
        <Button variant="ghost" size="sm" className="w-full" onClick={downloadAll} disabled={zipping}>
          <Download className="size-4" />
          {zipping ? 'Zipping…' : 'Download all'}
        </Button>
      )}

      <div className="flex items-center gap-1">
        {folder ? (
          <>
            <Button
              variant="ghost"
              size="sm"
              className="shrink-0"
              onClick={() => setFolder(folder.split('/').slice(0, -1).join('/'))}
            >
              <ChevronLeft className="size-4" />
              Back
            </Button>
            <span className="min-w-0 flex-1 truncate text-sm font-medium">
              {folder.split('/').pop()}
            </span>
          </>
        ) : (
          <span className="flex-1" />
        )}
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0 text-muted-foreground"
          onClick={() => setNewFolderOpen(true)}
        >
          <FolderPlus className="size-4" />
          New folder
        </Button>
      </div>

      {childFolders.length > 0 && (
        <ul className="space-y-1.5">
          {childFolders.map((name) => (
            <li key={name}>
              <button
                type="button"
                onClick={() => setFolder(folder ? `${folder}/${name}` : name)}
                className="flex w-full items-center gap-2 rounded-md border bg-card p-2 text-left hover:bg-accent/50"
              >
                <Folder className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{name}</span>
                <span className="text-xs text-muted-foreground tabular-nums">{countIn(name)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading files…</p>
      ) : visibleFiles.length === 0 ? (
        childFolders.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {folder ? 'Empty folder — drop files above to fill it.' : 'No files yet.'}
          </p>
        )
      ) : (
        <ul className="space-y-1.5">
          {visibleFiles.map((file) => (
            <li key={file.id} className="flex items-center gap-2 rounded-md border bg-card p-2">
              <FileText className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{file.file_name}</div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Badge variant="secondary" className="font-normal">
                    {fileCategoryLabels[file.category]}
                  </Badge>
                  {formatBytes(file.file_size) && <span>{formatBytes(file.file_size)}</span>}
                  <span>· {formatDate(file.uploaded_at)}</span>
                </div>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="size-7 shrink-0">
                    <MoreHorizontal className="size-4" />
                    <span className="sr-only">File actions</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {isPreviewable(file.mime_type) && (
                    <DropdownMenuItem onSelect={() => openPreview(file)}>
                      <Eye className="size-4" />
                      Preview
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onSelect={() => download(file)}>
                    <Download className="size-4" />
                    Download
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => {
                      setRenaming(file)
                      setRenameValue(file.file_name)
                    }}
                  >
                    <Pencil className="size-4" />
                    Rename
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setMoving(file)}>
                    <FolderInput className="size-4" />
                    Move to folder
                  </DropdownMenuItem>
                  <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(file)}>
                    <Trash2 className="size-4" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          ))}
        </ul>
      )}

      {/* Preview */}
      <Dialog open={!!preview} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent className="max-h-[90vh] sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="truncate pr-6">{preview?.file.file_name}</DialogTitle>
          </DialogHeader>
          {preview &&
            (preview.file.mime_type?.startsWith('image/') ? (
              <img src={preview.url} alt={preview.file.file_name} className="max-h-[70vh] w-full object-contain" />
            ) : (
              <iframe src={preview.url} title={preview.file.file_name} className="h-[70vh] w-full rounded-md border" />
            ))}
        </DialogContent>
      </Dialog>

      {/* Rename */}
      <Dialog open={!!renaming} onOpenChange={(open) => !open && setRenaming(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename file</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="rename-input">Name</Label>
            <Input
              id="rename-input"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && submitRename()}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenaming(null)} disabled={rename.isPending}>
              Cancel
            </Button>
            <Button onClick={submitRename} disabled={rename.isPending || !renameValue.trim()}>
              {rename.isPending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New folder */}
      <Dialog open={newFolderOpen} onOpenChange={setNewFolderOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>New folder</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="new-folder-input">Name</Label>
            <Input
              id="new-folder-input"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="Due diligence"
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && createFolder()}
            />
            <p className="text-xs text-muted-foreground">
              The folder appears in storage (and your synced Finder folder) with its first file.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewFolderOpen(false)}>
              Cancel
            </Button>
            <Button onClick={createFolder} disabled={!newFolderName.trim()}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Move to folder */}
      <Dialog open={!!moving} onOpenChange={(open) => !open && setMoving(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="truncate pr-6">Move “{moving?.file_name}”</DialogTitle>
          </DialogHeader>
          <ul className="max-h-72 space-y-1 overflow-y-auto">
            {['', ...[...allFolders].sort((a, b) => a.localeCompare(b))]
              .filter((target) => !moving || target !== folderOf(moving))
              .map((target) => (
                <li key={target || '(root)'}>
                  <button
                    type="button"
                    disabled={move.isPending}
                    onClick={() => moveTo(target)}
                    className="flex w-full items-center gap-2 rounded-md border bg-card p-2 text-left hover:bg-accent/50 disabled:opacity-50"
                  >
                    <Folder className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {target === '' ? 'All files (root)' : target}
                    </span>
                  </button>
                </li>
              ))}
          </ul>
        </DialogContent>
      </Dialog>

      <ConfirmDeleteDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete file?"
        description={`“${deleting?.file_name}” will be permanently removed.`}
        pending={remove.isPending}
        onConfirm={() =>
          deleting &&
          remove.mutate(deleting, {
            onSuccess: () => {
              toast.success('File deleted')
              setDeleting(null)
            },
            onError: () => {
              toast.error('Could not delete file')
              setDeleting(null)
            },
          })
        }
      />
    </div>
  )
}
