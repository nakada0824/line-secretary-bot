export type Intent =
  | 'ADD_SCHEDULE'
  | 'GET_SCHEDULES'
  | 'DELETE_SCHEDULE'
  | 'ADD_TASK'
  | 'GET_TASKS'
  | 'COMPLETE_TASK'
  | 'DELETE_TASK'
  | 'ADD_SHOPPING'
  | 'GET_SHOPPING'
  | 'DELETE_SHOPPING'
  | 'COMPLETE_SHOPPING'
  | 'LOG_HABIT'
  | 'GET_HABITS'
  | 'ADD_MEMO'
  | 'GET_MEMO'
  | 'SEARCH'
  | 'SEARCH_RESTAURANT'
  | 'SEARCH_OUTING'
  | 'SEARCH_NEWS'
  | 'SEARCH_ENTERTAINMENT'
  | 'SEARCH_RECIPE'
  | 'SUMMARIZE_URL'
  | 'TRANSLATE'
  | 'WEATHER_SEARCH'
  | 'ADD_BIRTHDAY'
  | 'GET_BIRTHDAYS'
  | 'ADD_CONSUMABLE'
  | 'GET_CONSUMABLES'
  | 'GET_TEMPLATE'
  | 'MORNING_REPORT'
  | 'EVENING_REPORT'
  | 'WEEKLY_SUMMARY'
  | 'CHECK_REMINDERS'
  | 'OPEN_WEB_APP'
  | 'INSTANT_REPLY'
  | 'CHAT';

export interface IntentResult {
  intent: Intent;
  data: Record<string, unknown>;
}

export interface User {
  user_id: string;
  display_name: string;
  picture_url?: string;
  location: string;
  created_at: string;
}

export interface Schedule {
  id: string;
  user_id: string;
  title: string;
  description?: string;
  start_time: string;
  end_time?: string;
  location?: string;
  reminded_1h: boolean;
  reminded_30m: boolean;
  created_at: string;
}

export interface Task {
  id: string;
  user_id: string;
  title: string;
  description?: string;
  priority: number;
  deadline?: string;
  completed: boolean;
  completed_at?: string;
  reminded_week: boolean;
  reminded_3days: boolean;
  reminded_1day: boolean;
  created_at: string;
}

export interface ShoppingItem {
  id: string;
  user_id: string;
  item: string;
  quantity?: string;
  checked: boolean;
  created_at: string;
}

export interface Consumable {
  id: string;
  user_id: string;
  name: string;
  reminder_days: number;
  last_purchase_date?: string;
  created_at: string;
}

export interface Habit {
  id: string;
  user_id: string;
  name: string;
  description?: string;
  streak: number;
  last_logged?: string;
  created_at: string;
}

export interface Memo {
  id: string;
  user_id: string;
  content: string;
  tags?: string[];
  created_at: string;
}

export interface Birthday {
  id: string;
  user_id: string;
  name: string;
  birth_date: string;
  created_at: string;
}

export interface Template {
  id: string;
  user_id: string;
  name: string;
  content: string;
  created_at: string;
}

export interface Conversation {
  id: string;
  user_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

export interface LineMessage {
  type: string;
  text?: string;
}

export interface LineEvent {
  type: string;
  replyToken?: string;
  source: {
    type: string;
    userId?: string;
  };
  message?: {
    type: string;
    id: string;
    text?: string;
  };
  timestamp: number;
}
