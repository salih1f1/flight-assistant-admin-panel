/**
 * A Blob's contents as text. Uses FileReader rather than Blob.text(): both do the job in a
 * browser, but only FileReader exists in jsdom, where the tests run.
 */
export function readBlobText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsText(blob)
  })
}
