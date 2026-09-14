// The traveler routes are {id:guid}. Anything else matches no route, and an unmatched /admin route
// fails the CORS preflight in the browser instead of returning 404, so an id is checked before it's sent.
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const isTravelerId = (id: string) => GUID.test(id)
