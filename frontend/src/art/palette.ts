/**
 * Hex palette for SVG artwork (mirrors src/styles/tokens.css so exported art renders standalone).
 *
 * The key names are kept from the original illustration system so every scene re-colours without
 * being redrawn; the values are the Playful Serenity palette.
 */
export const C = {
  cream50: "#F8F8F1", // warm ivory
  cream100: "#FFF9E8", // butter cream
  cream200: "#E8E6DD", // warm grey
  sand200: "#FFF4B8", // butter yellow
  peach100: "#FBEEE6", // soft peach, lighter
  peach200: "#F3DCCF", // soft peach
  coral100: "#E5DFF2", // muted lilac
  coral400: "#83BDB7", // soft teal (accent marks, sound arcs)
  teal100: "#E2F1EF", // pale teal
  teal300: "#BFDCD8", // light teal
  teal500: "#83BDB7", // soft teal
  teal700: "#397F83", // deep teal
  burgundy500: "#B7AAD6", // lilac, deeper (clothing accents)
  burgundy700: "#397F83", // deep teal (devices, solid shapes)
  burgundy900: "#344B50", // deep teal charcoal (line work)
  white: "#FFFFFF",
  pistachio: "#DCE8CE",
  skin: ["#F3D2BC", "#E2AE8A", "#C68A62", "#97603F", "#68402D"],
  hair: { dark: "#2C2A2B", brown: "#5A3D2B", grey: "#D8D6CF", auburn: "#8E4E32", sand: "#C9A274" },
} as const;

export const LINE = C.burgundy900;
export const STROKE = 3;
