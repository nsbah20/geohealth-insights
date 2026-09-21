import { act, render, screen } from "@testing-library/react";
import RetentionEnforcementPanel from "./RetentionEnforcementPanel";

jest.mock("axios", () => ({
  get: jest.fn(() => Promise.resolve({ data: [] })),
  post: jest.fn(),
}));

test("hides retention controls from non-administrators", () => {
  render(<RetentionEnforcementPanel authUser={{ canAdmin: false }} />);

  expect(screen.getByText(/Administrator access is required/i)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Check Eligible Records/i })).not.toBeInTheDocument();
});

test("shows retention preview controls to administrators", async () => {
  await act(async () => {
    render(<RetentionEnforcementPanel authUser={{ canAdmin: true }} />);
  });

  expect(screen.getByRole("button", { name: /Check Eligible Records/i })).toBeInTheDocument();
});
