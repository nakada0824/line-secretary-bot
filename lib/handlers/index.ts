import { IntentResult } from '@/types';
import * as schedule from './schedule';
import * as task from './task';
import * as shopping from './shopping';
import * as habit from './habit';
import * as memo from './memo';
import * as search from './search';
import * as birthday from './birthday';
import * as chatHandler from './chat';
import * as report from './report';

export async function handleIntent(
  userId: string,
  intentResult: IntentResult,
  userMessage: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>
): Promise<string> {
  const { intent, data } = intentResult;

  switch (intent) {
    case 'ADD_SCHEDULE':
      return schedule.addSchedule(userId, data);
    case 'GET_SCHEDULES':
      return schedule.getSchedules(userId, data);
    case 'DELETE_SCHEDULE':
      return schedule.deleteSchedule(userId, data);
    case 'ADD_TASK':
      return task.addTask(userId, data);
    case 'GET_TASKS':
      return task.getTasks(userId, data);
    case 'COMPLETE_TASK':
      return task.completeTask(userId, data);
    case 'DELETE_TASK':
      return task.deleteTask(userId, data);
    case 'ADD_SHOPPING':
      return shopping.addShopping(userId, data);
    case 'GET_SHOPPING':
      return shopping.getShopping(userId);
    case 'DELETE_SHOPPING':
      return shopping.deleteShopping(userId, data);
    case 'COMPLETE_SHOPPING':
      return shopping.completeShopping(userId, data);
    case 'LOG_HABIT':
      return habit.logHabit(userId, data);
    case 'GET_HABITS':
      return habit.getHabits(userId);
    case 'ADD_MEMO':
      return memo.addMemo(userId, data);
    case 'GET_MEMO':
      return memo.getMemo(userId, data);
    case 'GET_TEMPLATE':
      return memo.getTemplate(userId, data);
    case 'SEARCH':
      return search.searchQuery(data.query as string);
    case 'SEARCH_RESTAURANT':
      return search.searchRestaurant(data);
    case 'SEARCH_OUTING':
      return search.searchOuting(data);
    case 'SEARCH_NEWS':
      return search.searchNews(data);
    case 'SEARCH_ENTERTAINMENT':
      return search.searchEntertainment(data);
    case 'SEARCH_RECIPE':
      return search.searchRecipe(data);
    case 'SUMMARIZE_URL':
      return search.summarizeUrl(data);
    case 'TRANSLATE':
      return search.translate(data);
    case 'WEATHER_SEARCH':
      return search.searchWeather(data.query as string);
    case 'ADD_BIRTHDAY':
      return birthday.addBirthday(userId, data);
    case 'GET_BIRTHDAYS':
      return birthday.getBirthdays(userId);
    case 'ADD_CONSUMABLE':
      return shopping.addConsumable(userId, data);
    case 'GET_CONSUMABLES':
      return shopping.getConsumables(userId);
    case 'OPEN_WEB_APP': {
      const { url, label } = data as { url: string; label: string };
      return `${label}はこちらからどうぞ✨\n${url}`;
    }
    case 'MORNING_REPORT':
      return report.getMorningReport(userId);
    case 'EVENING_REPORT':
      return report.getEveningReport(userId);
    case 'WEEKLY_SUMMARY':
      return report.getWeeklySummaryReport(userId);
    case 'CHECK_REMINDERS':
      return report.getCheckReminders(userId);
    case 'CHAT':
    default:
      return chatHandler.chat(userMessage, history);
  }
}
