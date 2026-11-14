// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  act,
} from "@testing-library/react";
import { useTheme } from "./theme";

function ThemeConsumer() {
  const { theme, toggleTheme } = useTheme();
  return <button onClick={toggleTheme}>{theme}</button>;
}

let media: EventTarget & { matches: boolean };
beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove("dark");
  media = Object.assign(new EventTarget(), { matches: false });
  vi.stubGlobal("matchMedia", () => media);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("synchronizes multiple controls and persists a selected mode", () => {
  render(
    <>
      <ThemeConsumer />
      <ThemeConsumer />
    </>,
  );
  fireEvent.click(screen.getAllByRole("button", { name: "light" })[0]);
  expect(screen.getAllByRole("button", { name: "dark" })).toHaveLength(2);
  expect(localStorage.getItem("clutter-theme")).toBe("dark");
  expect(document.documentElement.classList.contains("dark")).toBe(true);
  fireEvent.click(screen.getAllByRole("button", { name: "dark" })[1]);
  expect(localStorage.getItem("clutter-theme")).toBe("light");
  expect(screen.getAllByRole("button", { name: "light" })).toHaveLength(2);
});

it("follows system changes until the user chooses a mode", () => {
  render(<ThemeConsumer />);
  act(() => {
    media.matches = true;
    media.dispatchEvent(new Event("change"));
  });
  expect(screen.getByRole("button", { name: "dark" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button"));
  act(() => {
    media.matches = true;
    media.dispatchEvent(new Event("change"));
  });
  expect(screen.getByRole("button", { name: "light" })).toBeTruthy();
});

it("updates from a theme change in another tab", () => {
  render(<ThemeConsumer />);
  act(() => {
    window.dispatchEvent(
      new StorageEvent("storage", { key: "clutter-theme", newValue: "dark" }),
    );
  });
  expect(screen.getByRole("button", { name: "dark" })).toBeTruthy();
});

it("still toggles when local storage is unavailable", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("Storage disabled");
  });
  render(<ThemeConsumer />);
  fireEvent.click(screen.getByRole("button"));
  expect(screen.getByRole("button", { name: "dark" })).toBeTruthy();
});
