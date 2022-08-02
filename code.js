// Copyright 2017, Google Inc. All Rights Reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/**
 * The base code of this script was originally published as follows:
 * @basename Account Anomaly Detector
 * @fileoverview The Account Anomaly Detector alerts the advertiser whenever an
 * advertiser account is suddenly behaving too differently from what's
 * historically observed. See
 * https://developers.google.com/google-ads/scripts/docs/solutions/account-anomaly-detector
 * for more details.
 * @baseauthor Google Ads Scripts Team [adwords-scripts@googlegroups.com]
 * @baseversion 2.1
 * @basechangelog
 * - version 2.1
 *   - Split into info, config, and code.
 * - version 2.0
 *   - Updated to use new Google Ads scripts features.
 * - version 1.1.1
 *   - Fixed bug in handling of reports with 0 rows.
 * - version 1.1
 *   - Added conversions to tracked statistics.
 * - version 1.0.3
 *   - Improved code readability and comments.
 * - version 1.0.2
 *   - Added validation for external spreadsheet setup.
 *   - Updated to use report version v201609.
 * - version 1.0.1
 *   - Improvements to time zone handling.
 * - version 1.0
 *   - Released initial version.
 */

/*            _ _              __  __ _      
 *   __ _  __| | |_ _ __ __ _ / _|/ _(_) ___ 
 *  / _` |/ _` | __| '__/ _` | |_| |_| |/ __|
 * | (_| | (_| | |_| | | (_| |  _|  _| | (__ 
 *  \__,_|\__,_|\__|_|  \__,_|_| |_| |_|\___|
 *
 * E: info@adtraffic.de | W: www.adtraffic.de
 * 
 * @name Account Anomaly Detector (MCC Version)
 * @author @ric_sti (Twitter)
 * @version 1.0
 * @gitHub  
 * @changelog
 * - version 1.0
 *   - Released initial version.
*/

/**
 * Configuration to be used for the Account Anomaly Detector.
 */
 CONFIG = {
  // URL of the default spreadsheet template. This should be a copy of
  // https://docs.google.com/spreadsheets/d/1k7gAEA-0iqVr1b7Vg31fYwp5PRWt8c9-Jv6VPPEXsmc/copy
  'spreadsheet_url': 'YOUR_SPREADSHEET_URL',

  // More reporting options can be found at
  // https://developers.google.com/google-ads/scripts/docs/reference/adsapp/adsapp#report_2
  'reporting_options': {
    // Comment out the following line to default to the latest reporting version.
    'apiVersion': 'v10'
  }
};
const SPREADSHEET_URL = CONFIG.spreadsheet_url;
const REPORTING_OPTIONS = CONFIG.reporting_options;

const FIELDS = ['segments.hour', 'segments.day_of_week', 'metrics.clicks',
        'metrics.impressions', 'metrics.conversions', 'metrics.cost_micros'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday',
            'Saturday', 'Sunday'];

/**
 * This script detects the anomalies(if any) in the account and alerts the
 * customer in form of a mail and spreadsheet.
 */

function main() {
  // Added for account iteration
  // Original main() function renamed to processAccount()

  // insert account IDs of managed accounts to be processed into this array or leave empty to process all managed accounts.
  const accountIds = []; // Example: ['123-123-1234','456-456-4567']
  var accountSelector
  if ( accountIds.length > 0 ) {
    accountSelector = AdsManagerApp.accounts().withIds(accountIds);
  } else {
    accountSelector = AdsManagerApp.accounts();
  }
  accountSelector.executeInParallel('processAccount');
}

function processAccount() {
  const accountId = AdsApp.currentAccount().getCustomerId();
  const accountName = AdsApp.currentAccount().getName();
  console.log('Processing ' + accountName + ' (' + accountId + ') ...');
  const sheetfile = validateAndGetSpreadsheet(SPREADSHEET_URL,accountId);
  // spreadsheet.setSpreadsheetTimeZone(AdsApp.currentAccount().getTimeZone()); // removed
  const spreadsheet = sheetfile.getSheetByName(accountId);
  
  // Added seaprate handling for namedRanges for each sheet due to overwrite errors in original version.
  let sheetRanges = [];
  let namedRanges = spreadsheet.getNamedRanges();
  for (let i=0;i<namedRanges.length;i++){
    sheetRanges.push({
      'name' : namedRanges[i].getName(),
      'range' : namedRanges[i].getRange().getA1Notation()
    });
  }
  const impressionsThreshold = parseField(spreadsheet.getRange(sheetRanges.filter(e => e.name.match(/impressions$/))[0].range).getValue());
  const clicksThreshold = parseField(spreadsheet.getRange(sheetRanges.filter(e => e.name.match(/clicks$/))[0].range).getValue());
  const conversionsThreshold = parseField(spreadsheet.getRange(sheetRanges.filter(e => e.name.match(/conversions$/))[0].range).getValue());
  const costThreshold = parseField(spreadsheet.getRange(sheetRanges.filter(e => e.name.match(/cost$/))[0].range).getValue());
  const weeksStr = spreadsheet.getRange(sheetRanges.filter(e => e.name.match(/weeks$/))[0].range).getValue();
  const weeks = parseInt(weeksStr.substring(0, weeksStr.indexOf(' ')),10);
  const email = spreadsheet.getRange(sheetRanges.filter(e => e.name.match(/email$/))[0].range).getValue();

  const now = new Date();

  // Basic reporting statistics are usually available with no more than a 3-hour
  // delay.
  const upTo = new Date(now.getTime() - 3 * 3600 * 1000);
  const upToHour = parseInt(getDateStringInTimeZone('h', upTo),10);

  if (upToHour == 1) {
    // first run for the day, kill existing alerts
    spreadsheet.getRange(sheetRanges.filter(e => e.name.match(/clicks_alert$/))[0].range).clearContent();
    spreadsheet.getRange(sheetRanges.filter(e => e.name.match(/impressions_alert$/))[0].range).clearContent();
    spreadsheet.getRange(sheetRanges.filter(e => e.name.match(/conversions_alert$/))[0].range).clearContent();
    spreadsheet.getRange(sheetRanges.filter(e => e.name.match(/cost_alert$/))[0].range).clearContent();
  }

  const dateRangeToCheck = getDateStringInPast(0, upTo);
  const dateRangeToEnd = getDateStringInPast(1, upTo);
  const dateRangeToStart = getDateStringInPast(1 + weeks * 7, upTo);
  const fields = FIELDS.join(",");
  const dayOfWeekIndex = parseInt(getDateStringInTimeZone('u', now), 10);
  const dayOfWeek = DAYS[dayOfWeekIndex].toUpperCase();
  const todayQuery = `SELECT ${fields} FROM customer ` +
      `WHERE segments.date BETWEEN "${dateRangeToCheck}" ` +
      `AND "${dateRangeToCheck}"`;
  const pastQuery = `SELECT ${fields} FROM customer ` +
      `WHERE segments.day_of_week=` +
      `"${dayOfWeek}" ` +
      `AND segments.date BETWEEN "${dateRangeToStart}" ` +
      `AND "${dateRangeToEnd}"`;
  const todayStats = getReportStats(todayQuery, upToHour, 1);
  const pastStats = getReportStats(pastQuery, upToHour, weeks);

  const statsExist = todayStats && pastStats;
  const formattedHour = `${upToHour}:00`;

  const alertText = [];
  if (statsExist) {
    if (impressionsThreshold &&
        todayStats.impressions < pastStats.impressions * impressionsThreshold) {
      const ImpressionsAlert = `    Impressions are too low: ` +
          `${todayStats.impressions} impressions by ${formattedHour},` +
          ` expecting at least ` +
          `${parseInt(pastStats.impressions * impressionsThreshold,10)}`;
      writeAlert(spreadsheet, sheetRanges.filter(e => e.name.match(/impressions_alert$/))[0].range, alertText, ImpressionsAlert,
          upToHour);
    }
    if (clicksThreshold &&
        todayStats.clicks < pastStats.clicks * clicksThreshold) {
      const clickAlert = `    Clicks are too low: ` +
          `${todayStats.clicks} clicks by ${formattedHour},` +
          ` expecting at least ` +
          `${(pastStats.clicks * clicksThreshold).toFixed(1)}`;
      writeAlert(spreadsheet, sheetRanges.filter(e => e.name.match(/clicks_alert$/))[0].range, alertText, clickAlert, upToHour);
    }
    if (conversionsThreshold &&
        todayStats.conversions < pastStats.conversions * conversionsThreshold) {
      const conversionsAlert =
          `    Conversions are too low: ` +
          `${todayStats.conversions} conversions by ${formattedHour},` +
          ` expecting at least ` +
          `${(pastStats.conversions * conversionsThreshold).toFixed(1)}`;
      writeAlert(
        spreadsheet, sheetRanges.filter(e => e.name.match(/conversions_alert$/))[0].range, alertText, conversionsAlert,
        upToHour);
    }
    if (costThreshold &&
        todayStats.cost > pastStats.cost * costThreshold) {
      const costAlert = `    Cost is too high: ` +
          `${todayStats.cost} ${AdsApp.currentAccount().getCurrencyCode()} ` +
          `by ${formattedHour}, expecting at most ` +
          `${(pastStats.cost * costThreshold).toFixed(2)}`;
      writeAlert(spreadsheet, sheetRanges.filter(e => e.name.match(/cost_alert$/))[0].range, alertText, costAlert, upToHour);
    }

    if (alertText.length > 0 && email && email.length > 0) {

      MailApp.sendEmail(email,
         `Google Ads Account ${accountName} (${accountId})` +
         ` misbehaved.`,
         `Your account ${accountName} (${accountId})` +
         ` is not performing as expected today: \n\n${alertText.join('\n')}` +
         `\n\nLog into Google Ads and take a look.\n\nAlerts dashboard: ` +
         `${SPREADSHEET_URL}`);
   }
  }
  writeDataToSpreadsheet(spreadsheet, now, statsExist, todayStats, pastStats,
      accountId, accountName, sheetRanges);
}

/**
 * Converts the value passed as number into a float value.
 *
 * @param {number} value that needs to be converted .
 * @return {number} A value that is of type float.
 */
function toFloat(value) {
  value = value.toString().replace(/,/g, '');
  return parseFloat(value);
}

/**
 * Converts the value passed to a float value.
 *
 * @param {number} value that needs to be converted .
 * @return {number} A value that is of type float.
 */
function parseField(value) {
  if (value == 'No alert') {
    return null;
  } else {
    return toFloat(value);
  }
}

/**
 * Converts the metrics.cost_micros by dividing it by a million to match the
 * output with version v1.1.1 of the file.
 * @param {number} value that needs to be converted.
 * @return {string} A value that is of type float.
 */
function toFloatFromMicros(value){
  value = parseFloat(value);
  return (value/1000000).toFixed(2);
}

/**
 * Runs a Google Ads report query for a number of weeks and return the average
 * values for the stats.
 *
 * @param {string} query The formatted report query.
 * @param {number} hours The limit hour of day for considering the report rows.
 * @param {number} weeks The number of weeks for the past stats.
 * @return {Object} An object containing the average values for the stats.
 */
function getReportStats(query, hours, weeks) {
  const reportRows = [];
  const report = AdsApp.search(query, REPORTING_OPTIONS);
  for(const row of report){
     reportRows.push(row);
  }
  return accumulateRows(reportRows, hours, weeks);
}

/**
 * Accumulate stats for a group of rows up to the hour specified.
 *
 * @param {!Object} rows The result of query.
 * @param {number} hours The limit hour of day for considering the report rows.
 * @param {number} weeks The number of weeks for the past stats.
 * @return {!Object} Stats aggregated up to the hour specified.
 */
function accumulateRows(rows, hours, weeks) {
  let result = {clicks: 0, impressions: 0, conversions: 0, cost: 0};

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const hour = row['segments']['hour'];
    if (hour < hours) {
      result = addRow(row, result, 1 / weeks);
    }
  }
  return result;
}

/**
 * Adds two stats rows together and returns the result.
 *
 * @param {!Object} row An individual row on which average operations is performed for every property.
 * @param {!Object} previous object initialized as 0 for every property.
 * @param {number} coefficient To get the Average of the properties.
 * @return {!Object} The addition of two stats rows.
 */
function addRow(row, previous, coefficient) {
  coefficient = coefficient || 1;
  row = row || {Clicks: 0, Impressions: 0, Conversions: 0, Cost: 0};
  previous = previous || {clicks: 0, impressions: 0, conversions: 0, cost: 0};
  return {
      clicks: parseInt(row['metrics']['clicks'],10) * coefficient + previous.clicks,
      impressions:
          parseInt(row['metrics']['impressions'],10) * coefficient + previous.impressions,
      conversions:
          parseInt(row['metrics']['conversions'],10) * coefficient + previous.conversions,
      cost: toFloatFromMicros(row['metrics']['costMicros']) * coefficient + previous.cost
    };
}

/**
 * Produces a formatted string representing a date in the past of a given date.
 *
 * @param {number} numDays The number of days in the past.
 * @param {Date} date A date object. Defaults to the current date.
 * @return {string} A formatted string in the past of the given date.
 */
function getDateStringInPast(numDays, date) {
  date = date || new Date();
  const MILLIS_PER_DAY = 1000 * 60 * 60 * 24;
  const past = new Date(date.getTime() - numDays * MILLIS_PER_DAY);
  return getDateStringInTimeZone('yyyy-MM-dd', past);
}


/**
 * Produces a formatted string representing a given date in a given time zone.
 *
 * @param {string} format A format specifier for the string to be produced.
 * @param {Date} [date] A date object. Defaults to the current date.
 * @param {string} [timeZone] A time zone. Defaults to the account's time zone.
 * @return {string} A formatted string of the given date in the given time zone.
 */
function getDateStringInTimeZone(format, date, timeZone) {
  date = date || new Date();
  timeZone = timeZone || AdsApp.currentAccount().getTimeZone();
  return Utilities.formatDate(date, timeZone, format);
}

/**
 * Validates the provided spreadsheet URL and email address
 * to make sure that they're set up properly. Throws a descriptive error message
 * if validation fails.
 *
 * @param {string} spreadsheeturl The URL of the spreadsheet to open.
 * @return {Spreadsheet} The spreadsheet object itself, fetched from the URL.
 * @throws {Error} If the spreadsheet URL or email hasn't been set
 */
function validateAndGetSpreadsheet(spreadsheeturl,accountId) {
  // Added variable accountId to pass to function prepareSheet
  if (spreadsheeturl == 'YOUR_SPREADSHEET_URL') {
    throw new Error(`Please specify a valid Spreadsheet URL. You can find` +
        ` a link to a template in the associated guide for this script.`);
  }
  const spreadsheet = SpreadsheetApp.openByUrl(spreadsheeturl);
  const sheet = prepareSheet(spreadsheet,accountId);
  const email = spreadsheet.getRangeByName('email').getValue();
  if ('foo@example.com' == email) {
    throw new Error(`Please either set a custom email address in the` +
        ` spreadsheet, or set the email field in the spreadsheet to blank` +
        ` to send no email.`);
  }
  return spreadsheet;
}

/**
 * Writes the alert time in the spreadsheet and push the alert message to the
 * list of messages.
 *
 * @param {Spreadsheet} spreadsheet The dashboard spreadsheet.
 * @param {string} rangeName The named range in the spreadsheet.
 * @param {Array<string>} alertText The list of alert messages.
 * @param {string} alertMessage The alert message.
 * @param {number} hour The limit hour used to get the stats.
 */
function writeAlert(spreadsheet, rangeA1, alertText, alertMessage, hour) {
  // Renamed variable rangeName to rangeA1 due to deviating handling of namedRanges
  const range = spreadsheet.getRange(rangeA1);
  if (!range.getValue() || range.getValue().length == 0) {
    alertText.push(alertMessage);
    range.setValue(`Alerting ${hour}:00`);
  }
}

/**
 * Writes the data to the spreadsheet.
 *
 * @param {Spreadsheet} spreadsheet The dashboard spreadsheet.
 * @param {Date} now The date corresponding to the running time of the script.
 * @param {boolean} statsExist A boolean that indicates the existence of stats.
 * @param {Object} todayStats The stats for today.
 * @param {Object} pastStats The past stats for the period defined in the
 * spreadsheet.
 * @param {string} accountId The account ID.
 */
function writeDataToSpreadsheet(spreadsheet, now, statsExist, todayStats,
                                pastStats, accountId, accountName, sheetRanges) {
  spreadsheet.getRange(sheetRanges.filter(e => e.name.match(/date$/))[0].range).setValue(now);
  spreadsheet.getRange(sheetRanges.filter(e => e.name.match(/account_id$/))[0].range).setValue(accountId);
  spreadsheet.getRange(sheetRanges.filter(e => e.name.match(/account_name$/))[0].range).setValue(accountName);
  spreadsheet.getRange(sheetRanges.filter(e => e.name.match(/timestamp$/))[0].range).setValue(
    getDateStringInTimeZone('E HH:mm:ss z', now));

  if (statsExist) {
    const dataRows = [
      [todayStats.impressions, pastStats.impressions.toFixed(0)],
      [todayStats.clicks, pastStats.clicks.toFixed(1)],
      [todayStats.conversions, pastStats.conversions.toFixed(1)],
      [todayStats.cost, pastStats.cost.toFixed(2)]
    ];
    spreadsheet.getRange(sheetRanges.filter(e => e.name.match(/data$/))[0].range).setValues(dataRows);
  }
}

function prepareSheet(spreadsheet,accountId){
  // Additional function to create new sheet for each managed account based on the template sheet
  if (!spreadsheet.getSheetByName(accountId)){
    let templateSheet = spreadsheet.getSheetByName('templateSheet');
    spreadsheet.insertSheet(accountId, 1, {template: templateSheet});
  }
  return spreadsheet.getSheetByName(accountId);
}
