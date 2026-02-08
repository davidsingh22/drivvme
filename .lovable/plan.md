
## Plan: Replace SVG with Uploaded Car Image

Replace the current SVG car icon inside the flashing circle (line 109-114) with the uploaded purple-and-green car image.

### Steps

1. **Copy the uploaded image** to `src/assets/drivveme-car-icon.png`
2. **Update `src/pages/Login.tsx`**:
   - Import the new image asset
   - Remove the existing SVG code inside the circle div (lines 112-113)
   - Replace it with an `<img>` tag using the imported asset
   - Size the image to fit nicely inside the circle (e.g., `h-14 w-14 object-contain`)
   - Make the circle slightly larger if needed (e.g., `h-24 w-24`) so the car image has room
   - Keep the existing `logo-icon-pulse` animation and glow effects intact
