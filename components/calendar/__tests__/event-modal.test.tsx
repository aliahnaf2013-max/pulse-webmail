import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
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
  const defaultProps = {
    calendars: [
      { id: 'cal-1', name: 'Primary', color: '#2563eb', isDefault: true } as any,
    ],
    onSave: vi.fn(),
    onClose: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('requests default Zoom settings from parent on mount and pre-fills fields upon receiving them', async () => {
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
});
