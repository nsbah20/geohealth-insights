import { act, render, screen } from "@testing-library/react";
import BackupRecoveryPanel from "./BackupRecoveryPanel";

jest.mock("axios", () => ({
  __esModule: true,
  default: {
    get: jest.fn(() => Promise.resolve({
      data: {
        backupCurrent: false,
        restoreTestCurrent: false,
        retentionDisposalAllowed: false,
        backupMaxAgeDays: 7,
        restoreTestMaxAgeDays: 90,
        backupHistory: [],
        restoreHistory: [],
      },
    })),
    post: jest.fn(),
  },
}));

test("hides recovery controls from non-administrators", () => {
  render(<BackupRecoveryPanel authUser={{ canAdmin: false }} />);

  expect(screen.getByText(/Administrator access is required/i)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Record Backup Evidence/i })).not.toBeInTheDocument();
});

test("shows recovery evidence controls to administrators", async () => {
  await act(async () => {
    render(<BackupRecoveryPanel authUser={{ canAdmin: true }} />);
  });

  expect(screen.getByRole("button", { name: /Record Backup Evidence/i })).toBeInTheDocument();
  expect(screen.getByText(/does not create a database snapshot/i)).toBeInTheDocument();
});
