/** Registry of renderable art pieces (used by the render page and tools/render-media.mjs). */
import type { ComponentType } from "react";
import { HeroFilm, type FilmLayout } from "./HeroFilm";
import { EmptyStateArt, GesturePortrait, UnavailableArt, Vignette, VoicePortrait } from "./Scenes";

export interface PieceProps {
  t: number;
  layout: FilmLayout;
}

export const ART_PIECES: Record<string, ComponentType<PieceProps>> = {
  film: ({ t, layout }) => <HeroFilm t={t} layout={layout} />,
  "portrait-voice": ({ t }) => <VoicePortrait t={t} />,
  "portrait-gesture": ({ t }) => <GesturePortrait t={t} />,
  "state-empty": () => <EmptyStateArt />,
  "state-unavailable": () => <UnavailableArt />,
  "vignette-family": ({ t }) => <Vignette id="family" t={t} />,
  "vignette-friends": ({ t }) => <Vignette id="friends" t={t} />,
  "vignette-caregiving": ({ t }) => <Vignette id="caregiving" t={t} />,
  "vignette-work": ({ t }) => <Vignette id="work" t={t} />,
  "vignette-appointment": ({ t }) => <Vignette id="appointment" t={t} />,
};
