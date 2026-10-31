/**
 * The quick expression board. Every phrase is spoken only after the person confirms the exact
 * words, through the same confirmation pipeline as any other message (see useQuickSay).
 */
import {
  Accessibility,
  Activity,
  Armchair,
  Bath,
  BatteryLow,
  Check,
  CircleHelp,
  Clock,
  CloudRain,
  Coffee,
  Cookie,
  DoorOpen,
  Frown,
  Glasses,
  GlassWater,
  Hand,
  Heart,
  HeartHandshake,
  Hourglass,
  Lamp,
  Laugh,
  Leaf,
  MapPin,
  MessageCircleHeart,
  MessagesSquare,
  Moon,
  OctagonX,
  PhoneCall,
  Pill,
  Repeat,
  Shuffle,
  Siren,
  Smile,
  Snail,
  Snowflake,
  Soup,
  Star,
  Stethoscope,
  Sunrise,
  Thermometer,
  TriangleAlert,
  Tv,
  Users,
  Utensils,
  Volume1,
  Wind,
  X,
  type LucideIcon,
} from "lucide-react";

export type CategoryId =
  | "greetings"
  | "feelings"
  | "yesno"
  | "food"
  | "needs"
  | "comfort"
  | "questions"
  | "social"
  | "medical"
  | "emergency";

export type Accent = "teal" | "butter" | "lilac" | "peach" | "pistachio";

export interface Category {
  id: CategoryId;
  label: string;
  accent: Accent;
  icon: LucideIcon;
}

export interface Expression {
  id: string;
  text: string;
  category: CategoryId;
  icon: string;
  custom?: boolean;
}

export const CATEGORIES: Category[] = [
  { id: "greetings", label: "Greetings", accent: "butter", icon: Hand },
  { id: "feelings", label: "Feelings", accent: "lilac", icon: Smile },
  { id: "yesno", label: "Yes / No", accent: "teal", icon: Check },
  { id: "food", label: "Food & drink", accent: "peach", icon: Utensils },
  { id: "needs", label: "Needs", accent: "pistachio", icon: GlassWater },
  { id: "comfort", label: "Comfort", accent: "lilac", icon: Armchair },
  { id: "questions", label: "Questions", accent: "teal", icon: CircleHelp },
  { id: "social", label: "Social", accent: "butter", icon: MessagesSquare },
  { id: "medical", label: "Medical help", accent: "pistachio", icon: Stethoscope },
  { id: "emergency", label: "Emergency", accent: "peach", icon: Siren },
];

export const ICONS: Record<string, LucideIcon> = {
  Accessibility, Activity, Armchair, Bath, BatteryLow, Check, CircleHelp, Clock, CloudRain, Coffee, Cookie, DoorOpen, Frown,
  Glasses, GlassWater, Hand, Heart, HeartHandshake, Hourglass, Lamp, Laugh, Leaf, MapPin, MessageCircleHeart, MessagesSquare,
  Moon, OctagonX, PhoneCall, Pill, Repeat, Shuffle, Siren, Smile, Snail, Snowflake, Soup, Star, Stethoscope, Sunrise,
  Thermometer, TriangleAlert, Tv, Users, Utensils, Volume1, Wind, X,
};

/** Icons offered when someone creates their own expression. */
export const CUSTOM_ICON_CHOICES = ["Star", "Heart", "Smile", "Hand", "Coffee", "Users", "MapPin", "Tv", "Leaf", "Clock", "Lamp", "Pill"];

export const EXPRESSIONS: Expression[] = [
  { id: "greet-hello", text: "Hello!", category: "greetings", icon: "Hand" },
  { id: "greet-morning", text: "Good morning.", category: "greetings", icon: "Sunrise" },
  { id: "greet-nice", text: "It's lovely to see you.", category: "greetings", icon: "Smile" },
  { id: "greet-soon", text: "See you soon.", category: "greetings", icon: "DoorOpen" },
  { id: "greet-night", text: "Good night.", category: "greetings", icon: "Moon" },

  { id: "feel-happy", text: "I'm happy.", category: "feelings", icon: "Laugh" },
  { id: "feel-tired", text: "I'm tired.", category: "feelings", icon: "BatteryLow" },
  { id: "feel-worried", text: "I feel worried.", category: "feelings", icon: "CloudRain" },
  { id: "feel-frustrated", text: "I'm frustrated.", category: "feelings", icon: "Frown" },
  { id: "feel-calm", text: "I feel calm.", category: "feelings", icon: "Leaf" },

  { id: "yes", text: "Yes.", category: "yesno", icon: "Check" },
  { id: "no", text: "No.", category: "yesno", icon: "X" },
  { id: "maybe", text: "Maybe.", category: "yesno", icon: "Shuffle" },
  { id: "not-now", text: "Not right now.", category: "yesno", icon: "Clock" },
  { id: "dont-know", text: "I don't know.", category: "yesno", icon: "CircleHelp" },

  { id: "food-hungry", text: "I'm hungry.", category: "food", icon: "Utensils" },
  { id: "food-tea", text: "A cup of tea, please.", category: "food", icon: "Coffee" },
  { id: "food-soft", text: "Something soft to eat, please.", category: "food", icon: "Soup" },
  { id: "food-snack", text: "Could I have a snack?", category: "food", icon: "Cookie" },
  { id: "food-enough", text: "No more, thank you.", category: "food", icon: "Hand" },

  { id: "needs-water", text: "I would like some water, please.", category: "needs", icon: "GlassWater" },
  { id: "needs-bathroom", text: "I need the bathroom.", category: "needs", icon: "Bath" },
  { id: "needs-move", text: "Please help me move.", category: "needs", icon: "Accessibility" },
  { id: "needs-warm", text: "I'm too warm.", category: "needs", icon: "Thermometer" },
  { id: "needs-cold", text: "I'm cold.", category: "needs", icon: "Snowflake" },
  { id: "needs-glasses", text: "I need my glasses.", category: "needs", icon: "Glasses" },

  { id: "comfort-thank-you", text: "Thank you.", category: "comfort", icon: "HeartHandshake" },
  { id: "comfort-sit", text: "Please sit with me.", category: "comfort", icon: "Armchair" },
  { id: "comfort-lights", text: "Could you dim the lights?", category: "comfort", icon: "Lamp" },
  { id: "comfort-quiet", text: "Could it be a little quieter?", category: "comfort", icon: "Volume1" },
  { id: "comfort-moment", text: "Give me a moment, please.", category: "comfort", icon: "Hourglass" },

  { id: "q-repeat", text: "Could you repeat that?", category: "questions", icon: "Repeat" },
  { id: "q-slower", text: "Could you speak a bit slower?", category: "questions", icon: "Snail" },
  { id: "q-time", text: "What time is it?", category: "questions", icon: "Clock" },
  { id: "q-who", text: "Who is coming today?", category: "questions", icon: "Users" },
  { id: "q-where", text: "Where are we going?", category: "questions", icon: "MapPin" },

  { id: "social-how", text: "How are you?", category: "social", icon: "MessageCircleHeart" },
  { id: "social-day", text: "Tell me about your day.", category: "social", icon: "MessagesSquare" },
  { id: "social-funny", text: "That's so funny!", category: "social", icon: "Laugh" },
  { id: "social-love", text: "I love you.", category: "social", icon: "Heart" },
  { id: "social-watch", text: "Shall we watch something?", category: "social", icon: "Tv" },

  { id: "med-pain", text: "I'm in pain.", category: "medical", icon: "Activity" },
  { id: "med-medication", text: "I need my medication.", category: "medical", icon: "Pill" },
  { id: "med-nurse", text: "Please ask my nurse to come.", category: "medical", icon: "Stethoscope" },
  { id: "med-dizzy", text: "I feel dizzy.", category: "medical", icon: "Shuffle" },
  { id: "med-breathing", text: "I'm finding it hard to breathe.", category: "medical", icon: "Wind" },

  { id: "sos-help", text: "I need help now.", category: "emergency", icon: "Siren" },
  { id: "sos-call", text: "Please call for help.", category: "emergency", icon: "PhoneCall" },
  { id: "sos-wrong", text: "Something is wrong.", category: "emergency", icon: "TriangleAlert" },
  { id: "sos-stop", text: "Stop, please.", category: "emergency", icon: "OctagonX" },
];

export function categoryOf(id: CategoryId): Category {
  return CATEGORIES.find((c) => c.id === id) ?? CATEGORIES[0];
}

export function iconFor(name: string): LucideIcon {
  return ICONS[name] ?? Star;
}

/** Built-in and custom expressions in one list. */
export function allExpressions(custom: { id: string; text: string; category: string; icon: string }[]): Expression[] {
  return [
    ...EXPRESSIONS,
    ...custom.map((c) => ({ ...c, category: (CATEGORIES.some((k) => k.id === c.category) ? c.category : "social") as CategoryId, custom: true })),
  ];
}
