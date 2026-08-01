import '@testing-library/jest-dom/vitest'

// jsdom's Blob implementation does not currently expose the browser-standard
// text() helper. Keep production code browser-native and fill the test-runtime
// gap with FileReader.
if (!Blob.prototype.text) {
  Blob.prototype.text = function text(): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        const bytes = reader.result as ArrayBuffer
        resolve(new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes))
      }
      reader.onerror = () => reject(reader.error)
      reader.readAsArrayBuffer(this)
    })
  }
}
