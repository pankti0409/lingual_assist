/** The original cast. Varied ages, skin tones, hair, clothing and communication/mobility needs. */
import { C } from "./palette";
import type { PersonLook } from "./Person";

export const CAST = {
  /** Hero patient: answers with a calibrated thumbs-up; uses a wheelchair. */
  asha: { skin: C.skin[3], hair: "curly", hairColor: C.hair.dark, top: C.teal500, topDetail: C.teal300, earring: true, wheelchair: true, age: "middle" },
  /** Hero partner: asks the question. */
  ravi: { skin: C.skin[1], hair: "short", hairColor: C.hair.grey, top: C.sand200, topDetail: C.coral400, glasses: true, beard: true, age: "older" },
  /** Family: speaks with a neck scarf after laryngectomy; with his mother. */
  daniel: { skin: C.skin[4], hair: "cropped", hairColor: C.hair.dark, top: C.teal300, scarf: C.coral400, age: "young" },
  nasreen: { skin: C.skin[2], hair: "headscarf", hairColor: C.hair.dark, headscarf: C.burgundy500, top: C.peach200, age: "older" },
  /** Friends: one uses an AAC tablet. */
  mei: { skin: C.skin[0], hair: "long", hairColor: C.hair.auburn, top: C.coral100, age: "young" },
  tomi: { skin: C.skin[4], hair: "bun", hairColor: C.hair.dark, top: C.teal500, earring: true, age: "middle" },
  /** Caregiving: an older man in a wheelchair with his caregiver. */
  joseph: { skin: C.skin[1], hair: "bald", hairColor: C.hair.grey, beard: true, top: C.burgundy500, wheelchair: true, age: "older" },
  grace: { skin: C.skin[4], hair: "bun", hairColor: C.hair.brown, top: C.sand200, topDetail: C.teal500, age: "middle" },
  /** Work. */
  priya: { skin: C.skin[2], hair: "long", hairColor: C.hair.dark, top: C.teal300, glasses: true, age: "middle" },
  sam: { skin: C.skin[0], hair: "curly", hairColor: C.hair.brown, top: C.peach200, age: "young" },
  /** Appointment: clinician in everyday clothes, no hospital setting. */
  ines: { skin: C.skin[3], hair: "short", hairColor: C.hair.dark, top: C.cream100, lanyard: true, age: "middle" },
  margaret: { skin: C.skin[1], hair: "bob", hairColor: C.hair.grey, top: C.coral400, glasses: true, age: "older" },
} satisfies Record<string, PersonLook>;
