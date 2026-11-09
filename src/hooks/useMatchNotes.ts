import { useCallback, useEffect, useMemo, useState } from 'react'
import { listMomentTags, listReviewTags, removeMomentTag } from '../lib/momentTags'
import { supabase } from '../lib/supabase'
import type { MomentTag, ReviewTag, RoundScreenshot, VodComment } from '../lib/types'

/**
 * A match's notes, screenshots and moment tags, and the editor's state: what the
 * VOD review and the Plays replay both feed `NotesPanel` and `CapturePanel`
 * with. It is one set of rows, so a note taken on either surface is on the other.
 *
 * `matchId` keys the moment tags and screenshots, `vodReviewId` the notes. They
 * arrive separately on the review page, so each resets its own rows.
 */
export function useMatchNotes(matchId: string | null | undefined, vodReviewId: string | null | undefined) {
  const [comments, setComments] = useState<VodComment[]>([])
  const [screenshots, setScreenshots] = useState<RoundScreenshot[]>([])
  // Named `reviewTags` because the review page's `tags` is the legacy auto `vod_tags` list.
  const [reviewTags, setReviewTags] = useState<ReviewTag[]>([])
  const [moments, setMoments] = useState<MomentTag[]>([])
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [captureOpen, setCaptureOpen] = useState(false)
  // Set → the capture panel is editing that note rather than creating a new one.
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null)

  // Another match's rows never show under this one, not even while its own load.
  const [heldReview, setHeldReview] = useState(vodReviewId)
  if (heldReview !== vodReviewId) {
    setHeldReview(vodReviewId)
    setComments([])
    setCaptureOpen(false)
    setEditingCommentId(null)
  }
  const [heldMatch, setHeldMatch] = useState(matchId)
  if (heldMatch !== matchId) {
    setHeldMatch(matchId)
    setScreenshots([])
    setMoments([])
    setTagFilter(null)
  }

  useEffect(() => {
    if (!vodReviewId) return
    let cancelled = false
    supabase
      .from('vod_comments')
      .select('*')
      .eq('vod_review_id', vodReviewId)
      .order('timestamp_seconds', { ascending: true })
      .then(({ data, error }) => {
        if (!cancelled && !error && data) setComments(data)
      })
    return () => {
      cancelled = true
    }
  }, [vodReviewId])

  // Moment tags key off the match, not the vod_review row — the ReviewRef is
  // `matches.match_id` so a tag lands on the same review on any surface.
  useEffect(() => {
    if (!matchId) return
    let cancelled = false
    Promise.all([listReviewTags(), listMomentTags({ type: 'vod', id: matchId })])
      .then(([vocabulary, applied]) => {
        if (cancelled) return
        setReviewTags(vocabulary)
        setMoments(applied)
      })
      .catch(err => console.error('Failed to load moment tags:', err))
    return () => {
      cancelled = true
    }
  }, [matchId])

  useEffect(() => {
    if (!matchId) return
    let cancelled = false
    async function loadScreenshots() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data, error } = await supabase
        .from('round_screenshots')
        .select('*')
        .eq('match_id', matchId!)
        .eq('user_id', user.id)
        .order('created_at', { ascending: true })
      if (!cancelled && !error && data) setScreenshots(data)
    }
    loadScreenshots()
    return () => {
      cancelled = true
    }
  }, [matchId])

  const handleCommentAdded = useCallback((comment: VodComment) => {
    setComments(prev => [...prev, comment].sort((a, b) => a.timestamp_seconds - b.timestamp_seconds))
  }, [])

  const handleCommentUpdated = useCallback((comment: VodComment) => {
    setComments(prev => prev.map(c => (c.id === comment.id ? comment : c)))
  }, [])

  const handleCommentDeleted = useCallback((commentId: string) => {
    setComments(prev => prev.filter(c => c.id !== commentId))
    // Don't leave the editor holding a note that no longer exists.
    setEditingCommentId(prev => (prev === commentId ? null : prev))
  }, [])

  const handleScreenshotAdded = useCallback((screenshot: RoundScreenshot) => {
    setScreenshots(prev => [...prev, screenshot])
  }, [])

  const handleScreenshotDeleted = useCallback((screenshotId: string) => {
    setScreenshots(prev => prev.filter(s => s.id !== screenshotId))
  }, [])

  /** The editor, for a new note. */
  const beginNote = useCallback(() => {
    setEditingCommentId(null)
    setCaptureOpen(true)
  }, [])

  /** The same editor, loaded with an existing note. */
  const beginEdit = useCallback((comment: VodComment) => {
    setEditingCommentId(comment.id)
    setCaptureOpen(true)
  }, [])

  const closeCapture = useCallback(() => {
    setCaptureOpen(false)
    setEditingCommentId(null)
  }, [])

  const handleMomentTagAdded = useCallback((moment: MomentTag) => {
    // Replace rather than skip on a known id: applying a tag that already
    // exists can return the same row with a `note_id` it did not have before.
    setMoments(prev =>
      [...prev.filter(m => m.id !== moment.id), moment].sort((a, b) => a.video_ts - b.video_ts),
    )
  }, [])

  /** Deleting a tag cascades its moments server-side; mirror that locally. */
  const handleTagDeleted = useCallback((tagId: string) => {
    setMoments(prev => prev.filter(m => m.tag_id !== tagId))
    setTagFilter(prev => (prev === tagId ? null : prev))
  }, [])

  const handleRemoveMomentTag = useCallback(async (moment: MomentTag) => {
    // Optimistic: the row is the user's own and the only failure is a network
    // one, in which case the reload puts it back.
    setMoments(prev => prev.filter(m => m.id !== moment.id))
    try {
      await removeMomentTag(moment.id)
    } catch (err) {
      console.error('Failed to remove the moment tag:', err)
      setMoments(prev => [...prev, moment].sort((a, b) => a.video_ts - b.video_ts))
    }
  }, [])

  const editingComment = useMemo(
    () => (editingCommentId ? comments.find(c => c.id === editingCommentId) ?? null : null),
    [comments, editingCommentId],
  )
  const editingMoments = useMemo(
    () => (editingComment ? moments.filter(m => m.note_id === editingComment.id) : []),
    [moments, editingComment],
  )

  return {
    comments,
    screenshots,
    reviewTags,
    setReviewTags,
    moments,
    tagFilter,
    setTagFilter,
    captureOpen,
    editingCommentId,
    editingComment,
    editingMoments,
    beginNote,
    beginEdit,
    closeCapture,
    handleCommentAdded,
    handleCommentUpdated,
    handleCommentDeleted,
    handleScreenshotAdded,
    handleScreenshotDeleted,
    handleMomentTagAdded,
    handleTagDeleted,
    handleRemoveMomentTag,
  }
}

export type MatchNotes = ReturnType<typeof useMatchNotes>
