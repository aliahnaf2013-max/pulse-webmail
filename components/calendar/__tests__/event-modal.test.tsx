import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventModal } from '../event-modal';

// Mock next-intl
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => {
    const translations: Record<string, string> = {
      'form.title': 'Title',
      'form.description': 'Description',
      'form.location': 'Location',
      'form.meeting_link': 'Meeting Link',
      'events.create': 'Create Event',
      'events.edit': 'Edit Event',
    };
    return translations[key] ?? key;
  },
}));

// Mock settings store
const mockSettingsState = {
  timeFormat: '24h',
};
vi.mock('@/stores/settings-store', () => ({
  useSettingsStore: (selector: any) => selector(mockSettingsState),
}));

// Mock date-fns format helper if needed
vi.mock('@/hooks/use-format-event-date', () => ({
  useFormatEventDate: () => () => 'Mocked Date',
}));

describe('EventModal Zoom Integration', () => {
  const originalParent = Object.getOwnPropertyDescriptor(window, 'parent');
  const defaultProps = {
    calendars: [
      { id: 'cal-1', name: 'Primary', color: '#2563eb', isDefault: true } as any,
    ],
    onSave: vi.fn(),
    onClose: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    if (originalParent) Object.defineProperty(window, 'parent', originalParent);
    document.head.innerHTML = '';
    vi.unstubAllGlobals();
  });

  function enablePortalMode() {
    Object.defineProperty(window, 'parent', {
      configurable: true,
      value: { postMessage: vi.fn() },
    });
    const meta = document.createElement('meta');
    meta.setAttribute('name', 'parent-origin');
    meta.setAttribute('content', 'https://app.pulsebusiness.ai');
    document.head.appendChild(meta);
  }

  it('requests default Zoom settings from parent on mount and pre-fills fields upon receiving them', async () => {
    enablePortalMode();
    const postMessageSpy = vi.spyOn(window.parent, 'postMessage');

    render(<EventModal {...defaultProps} />);

    // Assert it posted a request to parent
    expect(postMessageSpy).toHaveBeenCalledWith(
      { source: 'bulwark', type: 'profile:get-zoom-info' },
      'https://app.pulsebusiness.ai'
    );

    // Simulate postMessage response from parent Portal
    const messageEvent = new MessageEvent('message', {
      origin: 'https://app.pulsebusiness.ai',
      data: {
        source: 'portal',
        type: 'profile:zoom-info',
        zoom_meeting_id: '5114891649',
        zoom_meeting_url: 'https://zoom.us/j/5114891649',
      },
    });

    fireEvent(window, messageEvent);

    // Assert Location/Link inputs have been filled
    await waitFor(() => {
      const linkInput = screen.getByPlaceholderText('https://meet.example.com/...');
      expect(linkInput).toHaveValue('https://zoom.us/j/5114891649');
    });

    // Assert "Use Default Zoom ID" button exists and click it to set location
    const useZoomIdBtn = screen.getByText('Use Default Zoom ID');
    expect(useZoomIdBtn).toBeInTheDocument();

    const locationInput = screen.getByPlaceholderText('Location');
    fireEvent.click(useZoomIdBtn);
    expect(locationInput).toHaveValue('5114891649');
  });

  it('rejects postMessage responses from unauthorized origins', async () => {
    enablePortalMode();
    render(<EventModal {...defaultProps} />);

    const messageEvent = new MessageEvent('message', {
      origin: 'https://malicious-origin.com',
      data: {
        source: 'portal',
        type: 'profile:zoom-info',
        zoom_meeting_id: '5114891649',
        zoom_meeting_url: 'https://zoom.us/j/5114891649',
      },
    });

    fireEvent(window, messageEvent);

    // Inputs should remain empty
    const linkInput = screen.getByPlaceholderText('https://meet.example.com/...');
    expect(linkInput).toHaveValue('');

    expect(screen.queryByText('Use Default Zoom ID')).not.toBeInTheDocument();
  });

  it('sends zoom:create-meeting request to parent when Create Zoom Meeting is clicked and sets inputs on success', async () => {
    enablePortalMode();
    const postMessageSpy = vi.spyOn(window, 'postMessage');
    const parentPostMessageSpy = vi.spyOn(window.parent, 'postMessage');

    render(<EventModal {...defaultProps} />);

    // Click "Create Zoom Meeting" button
    const createBtn = screen.getByText('Create Zoom Meeting');
    expect(createBtn).toBeInTheDocument();
    fireEvent.click(createBtn);

    // Assert it posted request to parent
    expect(parentPostMessageSpy).toHaveBeenCalledWith(
      {
        source: 'bulwark',
        type: 'zoom:create-meeting',
        topic: 'Scheduled Meeting',
        startTime: expect.any(String),
        duration: 60,
      },
      'https://app.pulsebusiness.ai'
    );

    // Simulate parent replying with zoom:meeting-created
    const messageEvent = new MessageEvent('message', {
      origin: 'https://app.pulsebusiness.ai',
      data: {
        source: 'portal',
        type: 'zoom:meeting-created',
        join_url: 'https://zoom.us/j/987654321',
      },
    });

    fireEvent(window, messageEvent);

    // Assert inputs updated
    await waitFor(() => {
      const linkInput = screen.getByPlaceholderText('https://meet.example.com/...');
      expect(linkInput).toHaveValue('https://zoom.us/j/987654321');
    });

    const locationInput = screen.getByPlaceholderText('Location');
    expect(locationInput).toHaveValue('https://zoom.us/j/987654321');
  });

  it('loads default Zoom settings from same-origin API when standalone webmail is not embedded', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        configured: true,
        zoom_meeting_id: '5114891649',
        zoom_meeting_url: 'https://zoom.us/j/5114891649',
      }),
    } as Response);

    render(<EventModal {...defaultProps} />);

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/zoom/default', {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
    });

    await waitFor(() => {
      expect(screen.getByPlaceholderText('https://meet.example.com/...')).toHaveValue('https://zoom.us/j/5114891649');
    });
    expect(screen.getByPlaceholderText('Location')).toHaveValue('https://zoom.us/j/5114891649');
  });

  it('creates a dynamic Zoom meeting when Create Zoom Meeting is clicked outside the portal', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        configured: true,
        zoom_meeting_id: '5114891649',
        zoom_meeting_url: 'https://zoom.us/j/5114891649',
      }),
    } as Response);
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        fallback: false,
        meeting: {
          id: 987654321,
          join_url: 'https://zoom.us/j/987654321',
        },
      }),
    } as Response);

    render(<EventModal {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText('https://meet.example.com/...')).toHaveValue('https://zoom.us/j/5114891649');
    });

    const createBtn = screen.getByText('Create Zoom Meeting');
    fireEvent.click(createBtn);

    await waitFor(() => {
      expect(fetch).toHaveBeenLastCalledWith('/api/zoom/create', expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
      }));
      expect(screen.getByPlaceholderText('https://meet.example.com/...')).toHaveValue('https://zoom.us/j/987654321');
    });
    expect(createBtn).toHaveTextContent('Create Zoom Meeting');
  });
});
