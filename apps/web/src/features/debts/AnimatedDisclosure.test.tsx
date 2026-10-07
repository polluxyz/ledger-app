import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { AnimatedDisclosure } from './AnimatedDisclosure';

/** 驗證站內 motion token 歸零時收合不等待 transitionend，內容會直接卸載。 */
describe('AnimatedDisclosure', () => {
  it("unmounts collapsed content when data-motion is 'off'", async () => {
    const priorMotion = document.documentElement.getAttribute('data-motion');
    document.documentElement.setAttribute('data-motion', 'off');
    const user = userEvent.setup();

    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen((current) => !current)}>
            toggle
          </button>
          <AnimatedDisclosure id="animated-content" open={open}>
            <p>detail content</p>
          </AnimatedDisclosure>
        </>
      );
    }

    try {
      render(<Harness />);
      await user.click(screen.getByRole('button', { name: 'toggle' }));
      expect(screen.getByText('detail content')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'toggle' }));
      await waitFor(() => expect(screen.queryByText('detail content')).not.toBeInTheDocument());
    } finally {
      if (priorMotion === null) {
        document.documentElement.removeAttribute('data-motion');
      } else {
        document.documentElement.setAttribute('data-motion', priorMotion);
      }
    }
  });
});
