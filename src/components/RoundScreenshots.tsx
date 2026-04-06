import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'
import type { RoundScreenshot } from '../lib/types'
import { Plus, X, ChevronLeft, ChevronRight } from 'lucide-react'

interface RoundScreenshotsProps {
  matchId: string
  roundNumber: number
  screenshots: RoundScreenshot[]
  pastedFile: File | null
  onPasteConsumed: () => void
  onScreenshotAdded: (screenshot: RoundScreenshot) => void
  onScreenshotDeleted: (screenshotId: string) => void
}

async function uploadScreenshot(file: File, matchId: string, roundNumber: number): Promise<RoundScreenshot | null> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const path = `${user.id}/${matchId}/r${roundNumber}_${Date.now()}.png`

  const { error: uploadError } = await supabase.storage
    .from('round-screenshots')
    .upload(path, file, { contentType: file.type })

  if (uploadError) {
    console.error('Upload failed:', uploadError)
    return null
  }

  const { data: { publicUrl } } = supabase.storage
    .from('round-screenshots')
    .getPublicUrl(path)

  // Get image dimensions
  const { width, height } = await new Promise<{ width: number; height: number }>((resolve) => {
    const img = new Image()
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight })
      URL.revokeObjectURL(img.src)
    }
    img.onerror = () => {
      resolve({ width: 0, height: 0 })
      URL.revokeObjectURL(img.src)
    }
    img.src = URL.createObjectURL(file)
  })

  const { data, error } = await supabase
    .from('round_screenshots')
    .insert({
      user_id: user.id,
      match_id: matchId,
      round_number: roundNumber,
      storage_path: path,
      image_url: publicUrl,
      file_size: file.size,
      width: width || null,
      height: height || null,
    })
    .select()
    .single()

  if (error) {
    console.error('Failed to save screenshot record:', error)
    return null
  }

  return data
}

export default function RoundScreenshots({
  matchId, roundNumber, screenshots, pastedFile, onPasteConsumed,
  onScreenshotAdded, onScreenshotDeleted,
}: RoundScreenshotsProps) {
  const [uploading, setUploading] = useState(false)
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const [lightboxVisible, setLightboxVisible] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Handle pasted file
  useEffect(() => {
    if (!pastedFile) return

    if (pastedFile.size > 5 * 1024 * 1024) {
      console.error('Screenshot too large (max 5MB)')
      onPasteConsumed()
      return
    }

    setUploading(true)
    uploadScreenshot(pastedFile, matchId, roundNumber).then((result) => {
      if (result) onScreenshotAdded(result)
      onPasteConsumed()
      setUploading(false)
    })
  }, [pastedFile]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = '' // reset so same file can be re-selected

    if (file.size > 5 * 1024 * 1024) {
      console.error('Screenshot too large (max 5MB)')
      return
    }

    setUploading(true)
    const result = await uploadScreenshot(file, matchId, roundNumber)
    if (result) onScreenshotAdded(result)
    setUploading(false)
  }

  const handleDelete = async (screenshot: RoundScreenshot, e: React.MouseEvent) => {
    e.stopPropagation()
    await supabase.storage.from('round-screenshots').remove([screenshot.storage_path])
    await supabase.from('round_screenshots').delete().eq('id', screenshot.id)
    onScreenshotDeleted(screenshot.id)
  }

  const openLightbox = (index: number) => {
    setLightboxIndex(index)
    // Trigger fade-in on next frame
    requestAnimationFrame(() => setLightboxVisible(true))
  }

  const closeLightbox = () => {
    setLightboxVisible(false)
    setTimeout(() => setLightboxIndex(null), 150)
  }

  const navigateLightbox = (dir: 1 | -1) => {
    if (lightboxIndex === null) return
    const next = (lightboxIndex + dir + screenshots.length) % screenshots.length
    setLightboxIndex(next)
  }

  // Keyboard navigation for lightbox
  useEffect(() => {
    if (lightboxIndex === null) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeLightbox()
      else if (e.key === 'ArrowLeft') navigateLightbox(-1)
      else if (e.key === 'ArrowRight') navigateLightbox(1)
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [lightboxIndex, screenshots.length]) // eslint-disable-line react-hooks/exhaustive-deps

  if (screenshots.length === 0 && !uploading) {
    // Show just the upload button
    return (
      <div className="flex items-center gap-1.5 pl-4 pt-1">
        <button
          onClick={() => fileInputRef.current?.click()}
          className="w-14 h-10 rounded border border-dashed border-text-muted/30 flex items-center justify-center text-text-muted hover:text-val-cyan hover:border-val-cyan/30 transition-colors cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={handleFileSelect}
        />
      </div>
    )
  }

  return (
    <>
      <div className="flex items-center gap-1.5 pl-4 pt-1">
        {screenshots.map((s, i) => (
          <div key={s.id} className="relative group/thumb">
            <img
              src={s.image_url}
              alt={`Round ${roundNumber} screenshot`}
              className="w-14 h-10 rounded border border-bg-elevated object-cover cursor-pointer hover:ring-1 hover:ring-val-cyan/50 hover:scale-105 transition-all"
              onClick={() => openLightbox(i)}
            />
            <button
              onClick={(e) => handleDelete(s, e)}
              className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-black/70 flex items-center justify-center opacity-0 group-hover/thumb:opacity-100 transition-opacity text-text-muted hover:text-val-red"
            >
              <X className="w-2.5 h-2.5" />
            </button>
          </div>
        ))}
        {uploading && (
          <div className="w-14 h-10 rounded bg-bg-elevated animate-pulse" />
        )}
        <button
          onClick={() => fileInputRef.current?.click()}
          className="w-14 h-10 rounded border border-dashed border-text-muted/30 flex items-center justify-center text-text-muted hover:text-val-cyan hover:border-val-cyan/30 transition-colors cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={handleFileSelect}
        />
      </div>

      {lightboxIndex !== null && createPortal(
        <div
          className={`fixed inset-0 z-50 bg-black/85 flex items-center justify-center transition-opacity duration-150 ${lightboxVisible ? 'opacity-100' : 'opacity-0'}`}
          onClick={closeLightbox}
        >
          <img
            src={screenshots[lightboxIndex].image_url}
            alt={`Round ${roundNumber} screenshot`}
            className="max-w-[90vw] max-h-[85vh] object-contain rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />

          {/* Close button */}
          <button
            onClick={closeLightbox}
            className="absolute top-4 right-4 p-2 rounded-full bg-white/10 text-white/70 hover:text-white hover:bg-white/20 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>

          {/* Navigation arrows */}
          {screenshots.length > 1 && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); navigateLightbox(-1) }}
                className="absolute top-1/2 -translate-y-1/2 left-4 p-2 rounded-full bg-white/10 text-white/70 hover:text-white hover:bg-white/20 transition-colors"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); navigateLightbox(1) }}
                className="absolute top-1/2 -translate-y-1/2 right-4 p-2 rounded-full bg-white/10 text-white/70 hover:text-white hover:bg-white/20 transition-colors"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </>
          )}
        </div>,
        document.body
      )}
    </>
  )
}
