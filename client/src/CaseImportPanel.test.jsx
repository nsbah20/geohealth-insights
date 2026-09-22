import { act, render, screen } from "@testing-library/react";
import CaseImportPanel from "./CaseImportPanel";

vi.mock("axios", () => ({
  default: {
    get: vi.fn(() => Promise.resolve({ data: [] })),
    post: vi.fn(),
  },
}));

test("keeps case imports hidden behind an approved role", () => {
  render(<CaseImportPanel authUser={{ canImport: false }} />);

  expect(screen.getByText(/Administrator or Data Manager access is required/i)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Choose CSV/i })).not.toBeInTheDocument();
});

test("shows staging controls to an approved importer", async () => {
  await act(async () => {
    render(<CaseImportPanel authUser={{ canImport: true }} />);
  });

  expect(screen.getByRole("button", { name: /Choose CSV/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Download Template/i })).toBeInTheDocument();
});
