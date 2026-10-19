// TOM YUM BANG C brand constants. Visual tokens live in globals.css.
//
// The logo is the client-supplied artwork. It is served from /public and
// never redrawn. To switch to a transparent logo mark later, add the file
// under public/brand/ and point `mark` at it with `transparent: true`;
// no component needs to change.

export const BRAND = {
  name: "TOM YUM BANG C",
  tagline: "HALAL HOME",
  since: "SINCE 2015",
  company: "Tom yum bang C halal home company",
  product: "ระบบจัดการ Stock ภายในร้าน",
  // Browser UI colour (matches --background in globals.css).
  themeColor: "#fff9f5",
  logo: {
    src: "/brand/tom-yum-bang-c-logo.jpg",
    alt: "โลโก้ TOM YUM BANG C HALAL HOME",
  },
  mark: {
    src: "/brand/tom-yum-bang-c-logo.jpg",
    alt: "TOM YUM BANG C",
    // false: square artwork with its own background, shown clipped in a
    // rounded tile. true: transparent mark shown as-is.
    transparent: false,
  },
} as const;
