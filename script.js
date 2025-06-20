async function processFiles() {
    try {
        const loading = document.getElementById('loading');
        loading.style.display = 'block';
        
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
            loading.style.display = 'none'; // Hide loading
            return; // Exit if no courses
        }

        const groupedCourses = groupCoursesByDay(matchedCourses);
        displayTimetableAsHTML(groupedCourses); // New function to display HTML

        // PDF generation and download are removed as per requirements
        // const pdfBytes = await generatePDF(matchedCourses);
        // downloadPDF(pdfBytes, document.getElementById('filename').value);
    } catch (error) {
        alert(`Error: ${error.message}`);
        console.error(error);
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
        text += content.items.map(item => item.str).join(' ') + '\n'; // MODIFIED LINE
    }
    console.log(`Full extracted text from ${file.name}: `, text);
    return text;
}

function processTimetable(text) {
    console.log("Processing Timetable with text: ", text);
    const lines = text.split('\n'); // Split by newlines, assuming PDF text has them
    const courses = [];
    let currentDay = "Unknown"; // Default day

    // Regex for Day of the Week (simple match)
    const dayRegex = /^(MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY|SATURDAY|SUNDAY)$/i;

    // Regex for course details - this will need the most adjustment
    // Example: SOE 322 Software Quality Engineering 10:00am-12:00pm NHA1
    // Or: EEE 121 Circuit Theory I 2:00pm - 5:00pm CCT 2
    // This regex attempts to capture these parts. It's complex and will likely need refinement.
    const courseDetailRegex = /([A-Z]{3,4}(?:\/[A-Z]{3,4})?\s\d{3,4})\s+([A-Za-z0-9\s\(\)\-]+?)\s+(\d{1,2}:\d{2}[ap]?m?\s*(?:-|to)\s*\d{1,2}:\d{2}[ap]?m?)\s+([A-Za-z0-9\/-]+)/i;
    // Groups: 1: Code, 2: Name, 3: Time, 4: Hall


    lines.forEach(line => {
        const dayMatch = line.trim().match(dayRegex);
        if (dayMatch) {
            currentDay = dayMatch[1].toUpperCase(); // Standardize to uppercase
            console.log(`Identified day: ${currentDay}`);
        } else {
            const courseMatch = line.match(courseDetailRegex);
            if (courseMatch) {
                console.log("Course regex match on line: ", line, courseMatch);
                courses.push({
                    day: currentDay,
                    code: courseMatch[1].replace(/\s+/g, ' ').trim(),
                    name: courseMatch[2].trim(), // This will likely grab too much or too little initially
                    time: normalizeTime(courseMatch[3].trim()), // Assuming normalizeTime still works
                    hall: courseMatch[4].trim()
                });
            }
        }
    });

    console.log("Processed timetable entries (enhanced): ", courses);
    return courses;
}

function processCourses(text) {
    console.log("Processing Courses with text: ", text);
    const lines = text.split('\n'); // CORRECTED LINE
    const courses = [];
    const lineWithCourseCodeRegex = /^\s*\d+\s+([A-Z]{3,4}(?:\/[A-Z]{3,4})?\s+\d{3,4})\s+.*/; // CORRECTED REGEX

    lines.forEach(line => {
        const match = line.match(lineWithCourseCodeRegex);
        if (match && match[1]) {
            courses.push(match[1].replace(/\s+/g, ' ').trim()); // Corrected to use \s for consistency
        }
    });

    const uniqueCourses = [...new Set(courses)];
    console.log("Extracted course codes from student PDF (new logic): ", uniqueCourses);

    if (uniqueCourses.length === 0) {
        console.warn("New processCourses logic extracted 0 courses. Attempting fallback regex.");
        const courseRegexFallback = /([A-Z]{3,4}(?:\/[A-Z]{3,4})?\s\d{3,4})/g; // CORRECTED REGEX
        const fallbackMatches = text.match(courseRegexFallback);
        if (fallbackMatches) {
            const processedFallbackCodes = [...new Set(fallbackMatches)].map(code => code.replace(/\s+/g, ' ').trim()); // Corrected to use \s
            console.log("Processed course codes (fallback regex): ", processedFallbackCodes);
            return processedFallbackCodes;
        } else {
            console.log("Fallback regex in processCourses also found no matches.");
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
                    if (hour === 12) ampm = 'PM'; // e.g. 10 AM - 12 (PM)
                    else if (refStartHour24 && hour < refStartHour24 && hour <= 6) ampm = 'PM'; // e.g. 10 AM - 1 (PM)
                    else ampm = 'AM';
                } else if (refStartAmPm === 'PM') {
                    if (hour === 12) ampm = 'AM'; // e.g. 10 PM - 12 (AM, midnight)
                    else if (refStartHour24 && hour < refStartHour24 && hour <= 6) ampm = 'AM'; // e.g. 10 PM - 1 (AM)
                    else ampm = 'PM';
                } else { // Should not happen if refStartAmPm is provided
                    ampm = (hour >= 7 && hour <= 11) ? 'AM' : 'PM';
                }
            } else { // For start time, or if end time has no reference
                if (hour === 12) ampm = 'PM'; // 12 is PM unless specified as AM
                else if (hour >= 7 && hour <= 11) ampm = 'AM';
                else if (hour >= 1 && hour <= 6) ampm = 'PM';
                else ampm = 'PM'; // Default for ambiguous like 6-7
            }
        }
        
        let currentHour24 = hour;
        if (ampm === 'AM' && hour === 12) currentHour24 = 0; // Midnight case
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
    const startTimePart = timeString.split('-')[0].trim(); // "10:00 AM" or "2:30 PM"
    const timeMatch = startTimePart.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (!timeMatch) return 0; // Should not happen with normalizedTime

    let hours = parseInt(timeMatch[1]);
    const minutes = parseInt(timeMatch[2]);
    const ampm = timeMatch[3].toUpperCase();

    if (ampm === 'PM' && hours < 12) hours += 12;
    if (ampm === 'AM' && hours === 12) hours = 0; // Midnight case

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
    displayDiv.innerHTML = ''; // Clear previous content
    const table = document.createElement('table');
    table.classList.add('timetable-table');

    const dayOrder = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY", "Unknown"];

    dayOrder.forEach(day => {
        if (groupedCourses[day] && groupedCourses[day].length > 0) {
            const dayHead = table.createTHead(); // Create a new thead for each day section
            const dayRow = dayHead.insertRow();
            const dayCell = dayRow.insertCell();
            dayCell.colSpan = 4; // Span across all columns
            dayCell.textContent = day;
            dayCell.classList.add('day-header');

            const headerRow = dayHead.insertRow(); // Header for course details
            ['Time', 'Course Code', 'Course Name', 'Lecture Hall'].forEach(text => {
                const th = document.createElement('th');
                th.textContent = text;
                headerRow.appendChild(th);
            });

            const tbody = document.createElement('tbody');
            groupedCourses[day].forEach(course => {
                const row = tbody.insertRow();
                row.insertCell().textContent = course.time;
                row.insertCell().textContent = course.code;
                row.insertCell().textContent = course.name;
                row.insertCell().textContent = course.hall;
            });
            table.appendChild(tbody);
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

function downloadPDF(bytes, filename) {
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${filename}.pdf`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

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

        // Temporarily adapt parsePDF to take ArrayBuffer directly for debugging
        // Or, more robustly, make parsePDF flexible, which is harder for a subtask.
        // For this subtask, we'll simulate file objects for parsePDF.

        console.log("Parsing timetable PDF...");
        const timetableText = await parsePDFArrayBuffer(timetableArrayBuffer, 'general time table.pdf');
        console.log("Parsing courses PDF...");
        const coursesText = await parsePDFArrayBuffer(coursesArrayBuffer, '300 st.pdf');
        
        console.log("Processing timetable text (debug)...");
        const timetableData = processTimetable(timetableText); // Uses new processTimetable
        console.log("Processing courses text (debug)...");
        const coursesData = processCourses(coursesText);

        console.log("Matching courses (debug)...");
        const matchedCourses = matchCourses(timetableData, coursesData);

        if (!matchedCourses || !matchedCourses.length) {
            console.warn("Debug: No matching courses found from sample PDFs.");
            alert("Debug: No matching courses found. Check console for details on extracted data.");
            const displayDiv = document.getElementById('timetable-display');
            if (displayDiv) displayDiv.innerHTML = ''; // Clear old table
            loading.style.display = 'none'; // Hide loading
            return; // Exit if no courses
        }
        console.log("Debug: Matched courses found: ", matchedCourses);

        const groupedCourses = groupCoursesByDay(matchedCourses);
        console.log("Debug: Grouped courses: ", groupedCourses);

        displayTimetableAsHTML(groupedCourses);
        alert("Debug: HTML Timetable processing complete. Check the page and console for detailed logs.");

        // PDF generation and download are removed as per requirements
        // const pdfBytes = await generatePDF(matchedCourses);
        // downloadPDF(pdfBytes, "DebugTimetable");

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
        // The logging for individual items is already in the main parsePDF, 
        // but we can add a summary here if needed.
        console.log(`Raw text items from page ${i} of ${fileName}: `, content.items);
        text += content.items.map(item => item.str).join(' ') + '\n'; // Add newline between pages
    }
    console.log(`Full extracted text from ${fileName} (ArrayBuffer): `, text);
    return text;
}
