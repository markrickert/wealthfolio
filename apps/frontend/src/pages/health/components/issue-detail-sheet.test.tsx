import type { HealthIssue } from "@/lib/types";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { IssueDetailSheet } from "./issue-detail-sheet";

vi.mock("@wealthfolio/ui", () => ({
  ActionConfirm: ({ button }: { button: React.ReactNode }) => <>{button}</>,
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Button: ({
    children,
    asChild,
    ...props
  }: {
    children: React.ReactNode;
    asChild?: boolean;
    [key: string]: unknown;
  }) => {
    if (asChild && React.isValidElement(children)) {
      return React.cloneElement(children, props);
    }
    return (
      <button type="button" {...props}>
        {children}
      </button>
    );
  },
  Icons: {
    ArrowRight: () => <span>ArrowRight</span>,
    ChevronRight: () => <span>ChevronRight</span>,
    EyeOff: () => <span>EyeOff</span>,
    Spinner: () => <span>Spinner</span>,
    Wand2: () => <span>Wand2</span>,
  },
  ScrollArea: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div data-testid="scroll-area" className={className}>
      {children}
    </div>
  ),
  Sheet: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetContent: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div data-testid="sheet-content" className={className}>
      {children}
    </div>
  ),
  SheetHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));

const baseIssue: HealthIssue = {
  id: "timezone_missing:abc123",
  severity: "WARNING",
  category: "SETTINGS_CONFIGURATION",
  title: "Timezone not configured",
  message: "Set your timezone in General settings to ensure dates match your locale.",
  affectedCount: 1,
  dataHash: "abc123",
  timestamp: "2026-03-01T00:00:00Z",
  navigateAction: {
    route: "/settings/general",
    label: "Open General Settings",
  },
};

const noop = () => undefined;

function renderIssueSheet(issue: HealthIssue) {
  render(
    <MemoryRouter initialEntries={["/health"]}>
      <Routes>
        <Route
          path="/health"
          element={
            <IssueDetailSheet
              issue={issue}
              open={true}
              onOpenChange={noop}
              onDismiss={noop}
              onFix={noop}
              isDismissing={false}
              isFixing={false}
            />
          }
        />
        <Route path="/settings/general" element={<div>General Settings Page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("IssueDetailSheet", () => {
  it("shows timezone-specific category and copy for timezone issues", () => {
    renderIssueSheet(baseIssue);

    expect(screen.getAllByText("Timezone Settings").length).toBeGreaterThan(0);
    expect(screen.getByText(/Your app timezone is not configured/i)).toBeInTheDocument();
  });

  it("navigates with router link for General Settings action", async () => {
    const user = userEvent.setup();
    renderIssueSheet(baseIssue);

    await user.click(screen.getByRole("link", { name: /Open General Settings/i }));

    expect(screen.getByText("General Settings Page")).toBeInTheDocument();
  });

  it("keeps long issue details inside the scrollable body", () => {
    renderIssueSheet({
      ...baseIssue,
      category: "DATA_CONSISTENCY",
      title: "9 incomplete transfers detected",
      message: "A transfer is unpaired or missing its matching leg.",
      affectedCount: 9,
      affectedItems: Array.from({ length: 9 }, (_, index) => ({
        id: `transfer-${index}`,
        name: `Incomplete transfer ${index + 1}`,
      })),
      details: Array.from(
        { length: 9 },
        (_, index) =>
          `Incomplete transfer ${index + 1}\nThis transfer was treated as external; pair it or mark it external if intended.`,
      ).join("\n\n"),
    });

    const scrollArea = screen.getByTestId("scroll-area");

    expect(scrollArea).toHaveClass("min-h-0", "flex-1");
    expect(scrollArea).toContainElement(screen.getByText("Details"));
    expect(scrollArea).toContainElement(screen.getByText("About this issue"));
    expect(scrollArea).not.toContainElement(
      screen.getByRole("link", { name: /Open General Settings/i }),
    );
  });

  it("uses a wider responsive sheet for dense issue details", () => {
    renderIssueSheet({
      ...baseIssue,
      category: "DATA_CONSISTENCY",
      title: "7 incomplete transfers detected",
      affectedCount: 7,
    });

    expect(screen.getByTestId("sheet-content")).toHaveClass("sm:max-w-xl", "lg:max-w-2xl");
  });

  it("highlights individual detail entries and date lines", () => {
    renderIssueSheet({
      ...baseIssue,
      category: "DATA_CONSISTENCY",
      title: "2 valuation rows have unknown transfer classification",
      details: "Personal\nDate: 2023-02-20\n\nPersonal\nDate: 2025-03-02",
    });

    expect(screen.getByText("Date: 2023-02-20")).toHaveClass("font-mono", "tabular-nums");
    expect(screen.getByText("Date: 2025-03-02")).toHaveClass("font-mono", "tabular-nums");
  });

  it("serializes filtered activity navigation query params", () => {
    renderIssueSheet({
      ...baseIssue,
      category: "DATA_CONSISTENCY",
      title: "2 valuation rows have unknown transfer classification",
      navigateAction: {
        route: "/activities",
        label: "View Activities",
        query: {
          account: "acc-personal",
          types: "TRANSFER_IN,TRANSFER_OUT",
          from: "2023-02-20",
          to: "2025-03-02",
          q: "InternalSecurityTransfer",
        },
      },
    });

    const href = screen.getByRole("link", { name: /View Activities/i }).getAttribute("href");
    const url = new URL(href ?? "", "http://localhost");

    expect(url.pathname).toBe("/activities");
    expect(url.searchParams.get("account")).toBe("acc-personal");
    expect(url.searchParams.get("types")).toBe("TRANSFER_IN,TRANSFER_OUT");
    expect(url.searchParams.get("from")).toBe("2023-02-20");
    expect(url.searchParams.get("to")).toBe("2025-03-02");
    expect(url.searchParams.get("q")).toBe("InternalSecurityTransfer");
  });

  it("links date detail cards to the exact activity date", () => {
    renderIssueSheet({
      ...baseIssue,
      category: "DATA_CONSISTENCY",
      title: "2 valuation rows have unknown transfer classification",
      details: "Personal\nDate: 2023-02-20\n\nPersonal\nDate: 2025-03-02",
      navigateAction: {
        route: "/activities",
        label: "View Activities",
        query: {
          account: "acc-personal",
          types: "TRANSFER_IN,TRANSFER_OUT",
          from: "2023-02-20",
          to: "2025-03-02",
          q: "InternalSecurityTransfer",
        },
      },
    });

    const firstDetailLink = screen.getByText("Date: 2023-02-20").closest("a");
    const secondDetailLink = screen.getByText("Date: 2025-03-02").closest("a");
    const firstUrl = new URL(firstDetailLink?.getAttribute("href") ?? "", "http://localhost");
    const secondUrl = new URL(secondDetailLink?.getAttribute("href") ?? "", "http://localhost");

    expect(firstUrl.pathname).toBe("/activities");
    expect(firstUrl.searchParams.get("from")).toBe("2023-02-20");
    expect(firstUrl.searchParams.get("to")).toBe("2023-02-20");
    expect(firstUrl.searchParams.get("q")).toBe("InternalSecurityTransfer");
    expect(secondUrl.pathname).toBe("/activities");
    expect(secondUrl.searchParams.get("from")).toBe("2025-03-02");
    expect(secondUrl.searchParams.get("to")).toBe("2025-03-02");
    expect(secondUrl.searchParams.get("account")).toBe("acc-personal");
  });
});
