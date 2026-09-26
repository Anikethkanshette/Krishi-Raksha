# Image integration testing rules

- Always use base64-encoded images for all tests and requests.
- Accepted formats: JPEG, PNG, WEBP only.
- Do not upload blank, solid-color, or uniform-variance images.
- Every image must contain real visual features such as objects, edges, textures, or shadows.
- If an image is not PNG/JPEG/WEBP, transcode it to PNG or JPEG before upload and re-detect the MIME type.
- If animated, extract the first frame only.
- Resize large images to reasonable bounds before upload.