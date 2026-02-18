export type DiffStyle = "inline" | "two_sides";

export interface AppOptions {
  prompt: {
    template: string;
  };
  diff: {
    style: DiffStyle;
  };
}
