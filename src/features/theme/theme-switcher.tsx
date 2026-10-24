"use client";

import { Monitor, Moon, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  isThemePreference,
  THEME_LABELS,
  THEME_PREFERENCES,
  type ThemePreference,
} from "@/lib/theme/theme";

import { applyThemePreference } from "./theme-dom";
import { useThemePreference } from "./use-resolved-theme";

const ICONS = { system: Monitor, light: Sun, dark: Moon } satisfies Record<
  ThemePreference,
  unknown
>;

interface ThemeSwitcherProps {
  /** The server's preference (the cookie), for the first render. */
  initialPreference: ThemePreference;
  /** `icon` for the top bar; `labelled` (shows the choice as text) for Settings → Profile. */
  variant?: "icon" | "labelled";
}

/**
 * System / Light / Dark theme picker (README "Dark mode"): a Radix menu with radio items
 * (arrow keys, typeahead, Esc). A choice applies at once without a reload and is stored in
 * the `hq_theme` cookie. Every switcher on the page stays in sync through the `<html>` class.
 */
export function ThemeSwitcher({ initialPreference, variant = "icon" }: ThemeSwitcherProps) {
  const preference = useThemePreference(initialPreference);
  const Icon = ICONS[preference];
  const name = `Theme: ${THEME_LABELS[preference]}`;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant={variant === "icon" ? "ghost" : "outline"}
          size={variant === "icon" ? "icon" : "sm"}
          aria-label={name}
          title={variant === "icon" ? name : undefined}
        >
          <Icon aria-hidden="true" />
          {variant === "labelled" ? THEME_LABELS[preference] : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={preference}
          onValueChange={(value) => {
            if (isThemePreference(value)) applyThemePreference(value);
          }}
        >
          {THEME_PREFERENCES.map((option) => {
            const OptionIcon = ICONS[option];
            return (
              <DropdownMenuRadioItem key={option} value={option}>
                <OptionIcon aria-hidden="true" />
                {THEME_LABELS[option]}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
