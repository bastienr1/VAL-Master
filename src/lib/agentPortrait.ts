/**
 * How the game's agent portrait is framed inside a square card.
 *
 * The API image is a full figure on a wide transparent canvas, head near the
 * top. Enlarging it about a point just below the top edge brings the head and
 * shoulders into frame, over the agent's own backdrop colours. An uploaded
 * override is made to the slot's brief and gets none of this.
 */
export const PORTRAIT_FOCAL = { x: 0.5, y: 0 }
export const PORTRAIT_CLASS = 'origin-[50%_12%] scale-[3]'
