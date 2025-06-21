// Global variable to store grouped courses for PDF generation
let currentGroupedCourses = null;

async function processFiles() {
    try {
        const loading = document.getElementById('loading');
        loading.style.display = 'block';
        const downloadBtn = document.getElementById('download-pdf-button');
        downloadBtn.style.display = 'none'; // Hide button initially or on new generation
        
        const [timetableText, coursesText] = await Promise.all([
            parsePDF('timetable-pdf'),
            parsePDF('courses-pdf')
        ]);

        const timetableData = processTimetable(timetableText);
        const coursesData = processCourses(coursesText);
        const matchedCourses = matchCourses(timetableData, coursesData);

        if (!matchedCourses || !matchedCourses.length) {
            alert("No matching courses found. Please check your input files or the console for details on extracted data.");
            const displayDiv = document.getElementById('timetable-display');
            if (displayDiv) displayDiv.innerHTML = ''; // Clear old table
            currentGroupedCourses = null; // Clear stored data
            loading.style.display = 'none'; // Hide loading
            return; // Exit if no courses
        }

        const groupedCourses = groupCoursesByDay(matchedCourses);
        currentGroupedCourses = groupedCourses; // Store for PDF generation
        displayTimetableAsHTML(groupedCourses); // Display HTML table

        downloadBtn.style.display = 'block'; // Show download button
    } catch (error) {
        alert(`Error: ${error.message}`);
        console.error(error);
        currentGroupedCourses = null; // Clear stored data on error
        document.getElementById('download-pdf-button').style.display = 'none'; // Hide button on error
    } finally {
        loading.style.display = 'none';
    }
}

async function parsePDF(elementId) {
    const file = document.getElementById(elementId).files[0];
    if (!file) throw new Error("Please select both PDF files");

    const arrayBuffer = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsArrayBuffer(file);
    });

    const pdf = await pdfjsLib.getDocument(arrayBuffer).promise;
    let text = '';
    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        console.log(`Raw text items from page ${i} of ${file.name}: `, content.items);
        text += content.items.map(item => item.str).join(' ') + '\n'; // Corrected newline
    }
    console.log(`Full extracted text from ${file.name}: `, text);
    return text;
}

function processTimetable(text) {
    console.log("Processing Timetable with text (global regex per line): ", text);
    const lines = text.split('\n');
    const courses = [];
    let currentDay = "Unknown";

    const dayNames = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];

    const courseDetailRegex = /([A-Z]{3,4}(?:\/[A-Z]{3,4})?\s\d{3,4})\s+([A-Za-z0-9\s\(\)\-.:]+?)\s+(\d{1,2}:\d{2}[ap]?m?\s*(?:-|to)\s*\d{1,2}:\d{2}[ap]?m?)(?:\s+([A-Za-z0-9\s\(\)\/-]+))?/gi;
    const simpleCourseTimeRegex = /([A-Z]{3,4}(?:\/[A-Z]{3,4})?\s\d{3,4})\s+(?:Lec\s\d+\s)?(\d{1,2}:\d{2}[ap]?m?\s*(?:-|to)\s*\d{1,2}:\d{2}[ap]?m?)/gi;

    lines.forEach(line => {
        const trimmedLine = line.trim();
        if (trimmedLine === "") return;

        const upperTrimmedLine = trimmedLine.toUpperCase();
        for (const dayName of dayNames) {
            if (upperTrimmedLine.startsWith(dayName)) {
                currentDay = dayName;
                break;
            }
        }

        let match;
        let foundWithDetailed = false;
        courseDetailRegex.lastIndex = 0;
        while ((match = courseDetailRegex.exec(trimmedLine)) !== null) {
            foundWithDetailed = true;
            courses.push({
                day: currentDay,
                code: match[1].replace(/\s+/g, ' ').trim(),
                name: match[2].trim(),
                time: normalizeTime(match[3].trim()),
                hall: match[4] ? match[4].trim() : 'N/A'
            });
        }

        if (!foundWithDetailed) {
            simpleCourseTimeRegex.lastIndex = 0;
            while ((match = simpleCourseTimeRegex.exec(trimmedLine)) !== null) {
                console.log(`Line snippet matched by simpleCourseTimeRegex (detailed failed) for day ${currentDay}:`, trimmedLine.substring(match.index, match.index + 60) + "...");
                courses.push({
                    day: currentDay,
                    code: match[1].replace(/\s+/g, ' ').trim(),
                    name: 'Details N/A',
                    time: normalizeTime(match[2].trim()),
                    hall: 'N/A'
                });
            }
        }
    });

    console.log("Processed timetable entries (global regex per line): ", courses);
    return courses;
}

function processCourses(text) {
    console.log("Processing Courses with text (refined global search): ", text);
    const courses = [];
    const globalCourseCodeRegex = /\d+\s+([A-Z]{3,4}(?:\/[A-Z]{3,4})?\s+\d{3,4})/g;

    let match;
    while ((match = globalCourseCodeRegex.exec(text)) !== null) {
        courses.push(match[1].replace(/\s+/g, ' ').trim());
    }

    const uniqueCourses = [...new Set(courses)];
    console.log("Extracted course codes from student PDF (refined global search): ", uniqueCourses);

    if (uniqueCourses.length === 0) {
        console.warn("Refined global search extracted 0 courses. Attempting original fallback regex.");
        const courseRegexFallback = /([A-Z]{3,4}(?:\/[A-Z]{3,4})?\s\d{3,4})/g;
        const fallbackMatches = text.match(courseRegexFallback);
        if (fallbackMatches) {
            const processedFallbackCodes = [...new Set(fallbackMatches)].map(code => code.replace(/\s+/g, ' ').trim());
            console.log("Processed course codes (original fallback regex): ", processedFallbackCodes);
            return processedFallbackCodes;
        } else {
            console.log("Original fallback regex in processCourses also found no matches.");
            return [];
        }
    }
    return uniqueCourses;
}

function normalizeTime(timeStr) {
    console.log("Normalizing time (input): ", timeStr);

    let processedTimeStr = timeStr.toLowerCase();
    processedTimeStr = processedTimeStr.replace(/\s*to\s*|\s*-\s*/g, '-'); // Standardize separators

    const timeParts = processedTimeStr.split('-');
    let startTimeRaw = timeParts[0].trim();
    let endTimeRaw = timeParts.length > 1 ? timeParts[1].trim() : null;

    function parseAndFormatTimeComponent(timeComponent, isEndTime = false, refStartHour24 = null, refStartAmPm = null) {
        if (!timeComponent) return null;

        let hourStr = '', minuteStr = '00', ampm = '';
        let componentProcessed = timeComponent;

        if (componentProcessed.includes('a')) {
            ampm = 'AM';
            componentProcessed = componentProcessed.replace(/am?/, '');
        } else if (componentProcessed.includes('p')) {
            ampm = 'PM';
            componentProcessed = componentProcessed.replace(/pm?/, '');
        }
        componentProcessed = componentProcessed.trim();

        if (componentProcessed.includes(':')) {
            [hourStr, minuteStr] = componentProcessed.split(':');
            minuteStr = minuteStr.padStart(2, '0');
        } else {
            hourStr = componentProcessed; // Assumed to be hour
        }
        
        let hour = parseInt(hourStr);

        if (!ampm) { // Infer AM/PM if not specified
            if (isEndTime && refStartAmPm) {
                if (refStartAmPm === 'AM') {
                    if (hour === 12) ampm = 'PM';
                    else if (refStartHour24 && hour < refStartHour24 && hour <= 6) ampm = 'PM';
                    else ampm = 'AM';
                } else if (refStartAmPm === 'PM') {
                    if (hour === 12) ampm = 'AM';
                    else if (refStartHour24 && hour < refStartHour24 && hour <= 6) ampm = 'AM';
                    else ampm = 'PM';
                } else {
                    ampm = (hour >= 7 && hour <= 11) ? 'AM' : 'PM';
                }
            } else {
                if (hour === 12) ampm = 'PM';
                else if (hour >= 7 && hour <= 11) ampm = 'AM';
                else if (hour >= 1 && hour <= 6) ampm = 'PM';
                else ampm = 'PM';
            }
        }
        
        let currentHour24 = hour;
        if (ampm === 'AM' && hour === 12) currentHour24 = 0;
        else if (ampm === 'PM' && hour < 12) currentHour24 += 12;

        return { hour: hour, minute: minuteStr, ampm: ampm, hour24: currentHour24, full: `${hour}:${minuteStr} ${ampm}` };
    }

    const startTimeDetails = parseAndFormatTimeComponent(startTimeRaw);
    let finalStr = startTimeDetails.full;

    if (endTimeRaw) {
        const endTimeDetails = parseAndFormatTimeComponent(endTimeRaw, true, startTimeDetails.hour24, startTimeDetails.ampm);
        finalStr += ` - ${endTimeDetails.full}`;
    }

    console.log("Normalized time output: ", finalStr);
    return finalStr;
}

function parseStartTimeForSorting(timeString) {
    const startTimePart = timeString.split('-')[0].trim();
    const timeMatch = startTimePart.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (!timeMatch) return 0;

    let hours = parseInt(timeMatch[1]);
    const minutes = parseInt(timeMatch[2]);
    const ampm = timeMatch[3].toUpperCase();

    if (ampm === 'PM' && hours < 12) hours += 12;
    if (ampm === 'AM' && hours === 12) hours = 0;

    return hours * 60 + minutes;
}

function groupCoursesByDay(matchedCourses) {
    const groupedByDay = {};
    matchedCourses.forEach(course => {
        if (!groupedByDay[course.day]) {
            groupedByDay[course.day] = [];
        }
        groupedByDay[course.day].push(course);
    });

    for (const day in groupedByDay) {
        groupedByDay[day].sort((a, b) => parseStartTimeForSorting(a.time) - parseStartTimeForSorting(b.time));
    }
    console.log("Grouped and sorted courses by day: ", groupedByDay);
    return groupedByDay;
}

function displayTimetableAsHTML(groupedCourses) {
    const displayDiv = document.getElementById('timetable-display');
    displayDiv.innerHTML = '';
    const table = document.createElement('table');
    table.classList.add('timetable-table');

    const mainThead = table.createTHead();
    const headerRow = mainThead.insertRow();
    ['Course Code', 'Time', 'Lecturer Name'].forEach(text => {
        const th = document.createElement('th');
        th.textContent = text;
        headerRow.appendChild(th);
    });

    const dayOrder = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY", "Unknown"];

    dayOrder.forEach(day => {
        if (groupedCourses[day] && groupedCourses[day].length > 0) {
            const dayTbody = table.appendChild(document.createElement('tbody'));

            const dayHeaderRow = dayTbody.insertRow();
            const dayCell = dayHeaderRow.insertCell();
            dayCell.colSpan = 3;
            dayCell.textContent = day;
            dayCell.classList.add('day-header');

            groupedCourses[day].forEach(course => {
                const row = dayTbody.insertRow();
                row.insertCell().textContent = course.code;
                row.insertCell().textContent = course.time;
                row.insertCell().textContent = course.hall;
            });
        }
    });

    displayDiv.appendChild(table);
}

function matchCourses(timetable, courses) {
    console.log("Matching courses with timetable: ", timetable, "and courses: ", courses);
    if (timetable.length > 0) {
        console.log("First timetable entry in matchCourses:", timetable[0]);
    } else {
        console.log("matchCourses received an empty timetable array.");
    }
    const courseSet = new Set(courses);
    console.log("Course set for matching: ", courseSet);
    const matched = timetable.filter(entry => courseSet.has(entry.code))
        .sort((a, b) => a.time.localeCompare(b.time));
    console.log("Matched courses: ", matched);
    return matched;
}

async function generatePDF(courses) {
    const pdfDoc = await PDFLib.PDFDocument.create();
    const page = pdfDoc.addPage([600, 400]);
    
    let yPos = 350;
    page.drawText("Personalized Timetable\n\n", { x: 50, y: yPos, size: 20 });
    yPos -= 30;

    courses.forEach(course => {
        page.drawText(`${course.code}: ${course.time}`, { x: 50, y: yPos, size: 12 });
        yPos -= 20;
        if (yPos < 50) {
            yPos = 350;
            page = pdfDoc.addPage([600, 400]);
        }
    });

    return await pdfDoc.save();
}

// Updated generatePDF function
async function generatePDF(groupedCoursesData) {
    const { PDFDocument, rgb, StandardFonts } = PDFLib;
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([600, 840]); // Standard A4 portrait-like height
    const { width, height } = page.getSize();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    let yPos = height - 50;
    const xMargin = 50;
    const lineHeight = 18;
    const titleFontSize = 18;
    const dayFontSize = 14;
    const courseFontSize = 10;

    // Title
    const timetableName = document.getElementById('filename').value || "My Timetable";
    page.drawText(timetableName, {
        x: xMargin,
        y: yPos,
        font: boldFont,
        size: titleFontSize,
        color: rgb(0, 0, 0)
    });
    yPos -= (titleFontSize + 10);

    const dayOrder = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY", "Unknown"];

    for (const day of dayOrder) {
        if (groupedCoursesData[day] && groupedCoursesData[day].length > 0) {
            if (yPos < 80) { // Check for new page
                page = pdfDoc.addPage([600, 840]);
                yPos = height - 50;
            }

            // Day Header
            page.drawText(day, {
                x: xMargin,
                y: yPos,
                font: boldFont,
                size: dayFontSize,
                color: rgb(0.1, 0.1, 0.1)
            });
            yPos -= (dayFontSize + 5);

            groupedCoursesData[day].forEach(course => {
                if (yPos < 60) { // Check for new page before drawing course
                    page = pdfDoc.addPage([600, 840]);
                    yPos = height - 50;
                     // Optional: Re-draw day header if course spills to new page and is first item
                    page.drawText(day + " (cont.)", { x: xMargin, y: yPos, font: boldFont, size: dayFontSize, color: rgb(0.1,0.1,0.1) });
                    yPos -= (dayFontSize + 5);
                }
                const courseText = `${course.code}  |  ${course.time}  |  ${course.hall || 'N/A'} (${course.name || 'N/A'})`;
                page.drawText(courseText, {
                    x: xMargin + 10,
                    y: yPos,
                    font: font,
                    size: courseFontSize,
                    color: rgb(0.2, 0.2, 0.2)
                });
                yPos -= lineHeight;
            });
            yPos -= 10; // Extra space after a day's courses
        }
    }
    return await pdfDoc.save();
}

function downloadPDF(bytes, filename) {
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${filename}.pdf`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// Event listener for the download button
document.addEventListener('DOMContentLoaded', () => {
    const downloadBtn = document.getElementById('download-pdf-button');
    if (downloadBtn) {
        downloadBtn.addEventListener('click', async () => {
            if (!currentGroupedCourses) {
                alert("No timetable data available to download. Please generate a timetable first.");
                return;
            }
            const filename = document.getElementById('filename').value || "MyTimetable";

            // Show some visual feedback, e.g., disable button and change text
            downloadBtn.disabled = true;
            downloadBtn.textContent = 'Generating PDF...';

            try {
                const pdfBytes = await generatePDF(currentGroupedCourses);
                downloadPDF(pdfBytes, filename);
            } catch (error) {
                console.error("Error generating or downloading PDF:", error);
                alert("Failed to generate PDF. See console for details.");
            } finally {
                // Restore button state
                downloadBtn.disabled = false;
                downloadBtn.textContent = 'Download Timetable as PDF';
            }
        });
    }
});

async function debugProcessPDFs() {
    const loading = document.getElementById('loading');
    loading.style.display = 'block';
    console.log("Starting debugProcessPDFs with sample files...");

    try {
        // Define file paths for sample PDFs
        const timetablePDFPath = './test pdf/general time table.pdf';
        const coursesPDFPath = './test pdf/300 st.pdf';

        console.log(`Fetching timetable PDF: ${timetablePDFPath}`);
        const timetableResponse = await fetch(timetablePDFPath);
        if (!timetableResponse.ok) throw new Error(`Failed to fetch ${timetablePDFPath}: ${timetableResponse.statusText}`);
        const timetableArrayBuffer = await timetableResponse.arrayBuffer();
        console.log("Timetable PDF fetched successfully.");

        console.log(`Fetching courses PDF: ${coursesPDFPath}`);
        const coursesResponse = await fetch(coursesPDFPath);
        if (!coursesResponse.ok) throw new Error(`Failed to fetch ${coursesPDFPath}: ${coursesResponse.statusText}`);
        const coursesArrayBuffer = await coursesResponse.arrayBuffer();
        console.log("Courses PDF fetched successfully.");

        console.log("Parsing timetable PDF...");
        const timetableText = await parsePDFArrayBuffer(timetableArrayBuffer, 'general time table.pdf');
        console.log("Parsing courses PDF...");
        const coursesText = await parsePDFArrayBuffer(coursesArrayBuffer, '300 st.pdf');
        
        console.log("Processing timetable text (debug)...");
        const timetableData = processTimetable(timetableText);
        console.log("Processing courses text (debug)...");
        const coursesData = processCourses(coursesText);

        console.log("Matching courses (debug)...");
        const matchedCourses = matchCourses(timetableData, coursesData);

        if (!matchedCourses || !matchedCourses.length) {
            console.warn("Debug: No matching courses found from sample PDFs.");
            alert("Debug: No matching courses found. Check console for details on extracted data.");
            const displayDiv = document.getElementById('timetable-display');
            if (displayDiv) displayDiv.innerHTML = '';
            loading.style.display = 'none';
            return;
        }
        console.log("Debug: Matched courses found: ", matchedCourses);

        const groupedCourses = groupCoursesByDay(matchedCourses);
        console.log("Debug: Grouped courses: ", groupedCourses);

        displayTimetableAsHTML(groupedCourses);
        alert("Debug: HTML Timetable processing complete. Check the page and console for detailed logs.");

    } catch (error) {
        alert(`Debug Error: ${error.message}`);
        console.error("Error during debugProcessPDFs: ", error);
    } finally {
        loading.style.display = 'none';
        console.log("Finished debugProcessPDFs.");
    }
}

// Helper function to use with pdfjsLib directly with an ArrayBuffer
async function parsePDFArrayBuffer(arrayBuffer, fileName) {
    console.log(`Parsing ${fileName} from ArrayBuffer...`);
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    console.log(`${fileName} document loaded. Pages: ${pdf.numPages}`);
    let text = '';
    for (let i = 1; i <= pdf.numPages; i++) {
        console.log(`Getting page ${i} for ${fileName}`);
        const page = await pdf.getPage(i);
        console.log(`Getting text content for page ${i} of ${fileName}`);
        const content = await page.getTextContent();
        console.log(`Raw text items from page ${i} of ${fileName}: `, content.items);
        text += content.items.map(item => item.str).join(' ') + '\n';
    }
    console.log(`Full extracted text from ${fileName} (ArrayBuffer): `, text);
    return text;
}
