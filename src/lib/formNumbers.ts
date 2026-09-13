import { z } from 'zod'

// An empty <input type="number"> submits '', and a record's null fills its input
// as blank. z.coerce.number() turns both into 0 (Number('') === 0), which saves
// "no value" as a real zero: an airport without coordinates lands at 0,0. Map
// blanks to undefined before coercing; a typed 0 still parses as 0.
const blankToUndefined = (value: unknown) => (value === '' || value === null ? undefined : value)

/** An optional number field whose blank value means "not set", never 0. */
export const optionalNumber = () => z.preprocess(blankToUndefined, z.coerce.number().optional())

/** An optional whole-number field whose blank value means "not set", never 0. */
export const optionalInt = () => z.preprocess(blankToUndefined, z.coerce.number().int().optional())
