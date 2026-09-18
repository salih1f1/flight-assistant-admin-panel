// The traveler routes are {id:guid}. Anything else matches no route, and an unmatched /admin route
// fails the CORS preflight in the browser instead of returning 404, so an id is checked before it's sent.
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const isTravelerId = (id: string) => GUID.test(id)

/**
 * "689c6286" — a guid shortened to its first group, for a heading or a link that would otherwise
 * be 36 characters of hex. Anything else (a numeric id, a country code) is its own short form and
 * is returned unchanged. The full value always stays on the page beside it.
 */
export const shortId = (id: string) => (GUID.test(id) ? id.slice(0, 8) : id)
