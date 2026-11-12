"""
VisionGuard: AI-Powered Facial Access Control System
Document Generator Script (scripts/generate_docs_and_pdf.py)

Generates:
1. docs/VisionGuard_Complete_Project_Guide.docx
2. docs/VisionGuard_Complete_Project_Guide.pdf

Using python-docx and ReportLab with full styling, tables, callouts, and 14 chapters.
"""

import os
import sys
from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn

from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, KeepTogether, HRFlowable
)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.pdfgen import canvas

def set_cell_background(cell, fill_hex):
    tcPr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement('w:shd')
    shd.set(qn('w:val'), 'clear')
    shd.set(qn('w:color'), 'auto')
    shd.set(qn('w:fill'), fill_hex)
    tcPr.append(shd)

def generate_docx(guide_path, output_docx):
    print(f"Generating Word Document: {output_docx}...")
    doc = Document()

    # Page Margins: 1 inch
    for s in doc.sections:
        s.top_margin = Inches(1)
        s.bottom_margin = Inches(1)
        s.left_margin = Inches(1)
        s.right_margin = Inches(1)

    # Document Title Page
    title_p = doc.add_paragraph()
    title_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    title_p.paragraph_format.space_before = Pt(36)
    title_p.paragraph_format.space_after = Pt(12)
    run_title = title_p.add_run("VISIONGUARD")
    run_title.font.name = 'Arial'
    run_title.font.size = Pt(28)
    run_title.font.bold = True
    run_title.font.color.rgb = RGBColor(14, 116, 144) # Deep Cyan

    sub_p = doc.add_paragraph()
    sub_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    sub_p.paragraph_format.space_after = Pt(24)
    run_sub = sub_p.add_run("AI-Powered Facial Access Control System")
    run_sub.font.name = 'Arial'
    run_sub.font.size = Pt(16)
    run_sub.font.bold = True
    run_sub.font.color.rgb = RGBColor(71, 85, 105)

    desc_p = doc.add_paragraph()
    desc_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    desc_p.paragraph_format.space_after = Pt(36)
    run_desc = desc_p.add_run("Comprehensive Technical Project Guide, Architecture & Viva Handbook\nCollege Minor Project Documentation")
    run_desc.font.name = 'Calibri'
    run_desc.font.size = Pt(12)
    run_desc.font.italic = True
    run_desc.font.color.rgb = RGBColor(100, 116, 139)

    # Meta Table on Title Page
    meta_table = doc.add_table(rows=4, cols=2)
    meta_table.alignment = WD_TABLE_ALIGNMENT.CENTER
    meta_data = [
        ("Project Title:", "VisionGuard: AI-Powered Facial Access Control System"),
        ("Academic Level:", "Undergraduate B.Tech / B.E. Computer Science Minor Project"),
        ("Team Structure:", "3-Member Collaborative Engineering Team"),
        ("Technologies:", "HTML5, CSS3, Vanilla JS (ES Modules), TensorFlow.js, WebGL")
    ]
    for row_idx, (label, val) in enumerate(meta_data):
        row = meta_table.rows[row_idx]
        c0 = row.cells[0]
        c1 = row.cells[1]
        c0.width = Inches(2.2)
        c1.width = Inches(4.3)
        p0 = c0.paragraphs[0]
        r0 = p0.add_run(label)
        r0.font.bold = True
        r0.font.size = Pt(10)
        p1 = c1.paragraphs[0]
        r1 = p1.add_run(val)
        r1.font.size = Pt(10)
        set_cell_background(c0, "F1F5F9")
        set_cell_background(c1, "F8FAFC")

    doc.add_page_break()

    # Read markdown content and populate docx
    with open(guide_path, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    in_code_block = False
    code_lines = []

    for line in lines:
        stripped = line.strip()

        if stripped.startswith("```"):
            if in_code_block:
                # End code block
                in_code_block = False
                code_text = "".join(code_lines)
                code_lines = []
                p = doc.add_paragraph()
                p.paragraph_format.space_before = Pt(6)
                p.paragraph_format.space_after = Pt(6)
                p.paragraph_format.left_indent = Inches(0.4)
                r = p.add_run(code_text)
                r.font.name = 'Courier New'
                r.font.size = Pt(9)
                r.font.color.rgb = RGBColor(30, 41, 59)
            else:
                in_code_block = True
                code_lines = []
            continue

        if in_code_block:
            code_lines.append(line)
            continue

        if not stripped:
            continue

        if stripped.startswith("# "):
            heading_text = stripped[2:].strip()
            # Skip duplicated title
            if "Comprehensive Technical Project Guide" in heading_text or "VisionGuard" in heading_text:
                continue
            p = doc.add_paragraph()
            p.paragraph_format.space_before = Pt(18)
            p.paragraph_format.space_after = Pt(8)
            run = p.add_run(heading_text)
            run.font.name = 'Arial'
            run.font.size = Pt(16)
            run.font.bold = True
            run.font.color.rgb = RGBColor(15, 23, 42)

        elif stripped.startswith("## "):
            heading_text = stripped[3:].strip()
            p = doc.add_paragraph()
            p.paragraph_format.space_before = Pt(14)
            p.paragraph_format.space_after = Pt(6)
            run = p.add_run(heading_text)
            run.font.name = 'Arial'
            run.font.size = Pt(13)
            run.font.bold = True
            run.font.color.rgb = RGBColor(2, 132, 199)

        elif stripped.startswith("### "):
            heading_text = stripped[4:].strip()
            p = doc.add_paragraph()
            p.paragraph_format.space_before = Pt(10)
            p.paragraph_format.space_after = Pt(4)
            run = p.add_run(heading_text)
            run.font.name = 'Arial'
            run.font.size = Pt(11)
            run.font.bold = True
            run.font.color.rgb = RGBColor(51, 65, 85)

        elif stripped.startswith("- ") or stripped.startswith("* "):
            bullet_text = stripped[2:].strip()
            p = doc.add_paragraph(style='List Bullet')
            p.paragraph_format.space_after = Pt(3)
            r = p.add_run(bullet_text)
            r.font.name = 'Calibri'
            r.font.size = Pt(10.5)

        elif stripped.startswith("> "):
            quote_text = stripped[2:].strip()
            p = doc.add_paragraph()
            p.paragraph_format.left_indent = Inches(0.4)
            p.paragraph_format.space_after = Pt(4)
            r = p.add_run(quote_text)
            r.font.name = 'Calibri'
            r.font.size = Pt(10)
            r.font.italic = True
            r.font.color.rgb = RGBColor(71, 85, 105)

        else:
            p = doc.add_paragraph()
            p.paragraph_format.space_after = Pt(6)
            p.paragraph_format.line_spacing = 1.15
            r = p.add_run(stripped)
            r.font.name = 'Calibri'
            r.font.size = Pt(10.5)
            r.font.color.rgb = RGBColor(30, 41, 59)

    doc.save(output_docx)
    print(f"Word document successfully created: {output_docx} (Size: {os.path.getsize(output_docx)} bytes)")

class NumberedCanvas(canvas.Canvas):
    def __init__(self, *args, **kwargs):
        super(NumberedCanvas, self).__init__(*args, **kwargs)
        self._saved_page_states = []

    def showPage(self):
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        num_pages = len(self._saved_page_states)
        for state in self._saved_page_states:
            self.__dict__.update(state)
            self.draw_page_number(num_pages)
            canvas.Canvas.showPage(self)
        canvas.Canvas.save(self)

    def draw_page_number(self, page_count):
        if self._pageNumber == 1:
            return  # Skip cover page
        self.saveState()
        self.setFont("Helvetica", 9)
        self.setFillColor(colors.HexColor("#64748B"))
        
        # Header
        self.drawString(54, 11 * inch - 36, "VisionGuard: AI-Powered Facial Access Control System")
        self.setStrokeColor(colors.HexColor("#E2E8F0"))
        self.setLineWidth(0.5)
        self.line(54, 11 * inch - 42, 8.5 * inch - 54, 11 * inch - 42)
        
        # Footer
        self.line(54, 46, 8.5 * inch - 54, 46)
        page_str = f"Page {self._pageNumber} of {page_count}"
        self.drawRightString(8.5 * inch - 54, 32, page_str)
        self.drawString(54, 32, "College Minor Project Technical Handbook")
        self.restoreState()

def generate_pdf(guide_path, output_pdf):
    print(f"Generating PDF Document: {output_pdf}...")
    doc = SimpleDocTemplate(
        output_pdf,
        pagesize=letter,
        leftMargin=54,
        rightMargin=54,
        topMargin=54,
        bottomMargin=54
    )

    styles = getSampleStyleSheet()

    title_style = ParagraphStyle(
        'DocTitle',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=24,
        leading=28,
        textColor=colors.HexColor('#0F172A'),
        alignment=1, # Center
        spaceAfter=10
    )

    subtitle_style = ParagraphStyle(
        'DocSubtitle',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=14,
        leading=18,
        textColor=colors.HexColor('#0284C7'),
        alignment=1,
        spaceAfter=16
    )

    meta_style = ParagraphStyle(
        'DocMeta',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=10,
        leading=14,
        textColor=colors.HexColor('#64748B'),
        alignment=1,
        spaceAfter=24
    )

    h1_style = ParagraphStyle(
        'DocH1',
        parent=styles['Heading1'],
        fontName='Helvetica-Bold',
        fontSize=15,
        leading=19,
        textColor=colors.HexColor('#0F172A'),
        spaceBefore=16,
        spaceAfter=8,
        keepWithNext=True
    )

    h2_style = ParagraphStyle(
        'DocH2',
        parent=styles['Heading2'],
        fontName='Helvetica-Bold',
        fontSize=12,
        leading=16,
        textColor=colors.HexColor('#0284C7'),
        spaceBefore=12,
        spaceAfter=6,
        keepWithNext=True
    )

    h3_style = ParagraphStyle(
        'DocH3',
        parent=styles['Heading3'],
        fontName='Helvetica-Bold',
        fontSize=10.5,
        leading=14,
        textColor=colors.HexColor('#334155'),
        spaceBefore=8,
        spaceAfter=4,
        keepWithNext=True
    )

    body_style = ParagraphStyle(
        'DocBody',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=9.5,
        leading=13.5,
        textColor=colors.HexColor('#1E293B'),
        spaceAfter=6
    )

    bullet_style = ParagraphStyle(
        'DocBullet',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=9.5,
        leading=13.5,
        leftIndent=15,
        firstLineIndent=-10,
        textColor=colors.HexColor('#1E293B'),
        spaceAfter=3
    )

    code_style = ParagraphStyle(
        'DocCode',
        parent=styles['Normal'],
        fontName='Courier',
        fontSize=8,
        leading=11,
        textColor=colors.HexColor('#0F172A'),
        leftIndent=15,
        spaceAfter=6
    )

    story = []

    # Title Page
    story.append(Spacer(1, 40))
    story.append(Paragraph("VISIONGUARD", title_style))
    story.append(Paragraph("AI-Powered Facial Access Control System", subtitle_style))
    story.append(Paragraph("Comprehensive Technical Project Guide, Architecture & Viva Handbook<br/>College Minor Project Documentation", meta_style))
    story.append(Spacer(1, 20))

    # Summary Info Table on Title Page
    meta_table_data = [
        [Paragraph("<b>Project Title:</b>", body_style), Paragraph("VisionGuard: AI-Powered Facial Access Control System", body_style)],
        [Paragraph("<b>Academic Scope:</b>", body_style), Paragraph("Undergraduate B.Tech / B.E. Computer Science Minor Project", body_style)],
        [Paragraph("<b>Team Structure:</b>", body_style), Paragraph("3-Member Collaborative Engineering Team", body_style)],
        [Paragraph("<b>Core Stack:</b>", body_style), Paragraph("HTML5, CSS3, Vanilla JS (ES Modules), TensorFlow.js, WebGL", body_style)]
    ]
    t = Table(meta_table_data, colWidths=[130, 360])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), colors.HexColor('#F8FAFC')),
        ('BOX', (0,0), (-1,-1), 1, colors.HexColor('#E2E8F0')),
        ('INNERGRID', (0,0), (-1,-1), 0.5, colors.HexColor('#E2E8F0')),
        ('TOPPADDING', (0,0), (-1,-1), 6),
        ('BOTTOMPADDING', (0,0), (-1,-1), 6),
    ]))
    story.append(t)
    story.append(PageBreak())

    # Process Markdown lines
    with open(guide_path, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    in_code = False
    code_buffer = []

    for line in lines:
        stripped = line.strip()

        if stripped.startswith("```"):
            if in_code:
                in_code = False
                code_text = "<br/>".join([c.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;') for c in code_buffer])
                code_buffer = []
                story.append(Paragraph(code_text, code_style))
                story.append(Spacer(1, 4))
            else:
                in_code = True
                code_buffer = []
            continue

        if in_code:
            code_buffer.append(line.rstrip('\n'))
            continue

        if not stripped:
            continue

        # Clean markdown special characters for ReportLab XML
        clean_text = stripped.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
        clean_text = clean_text.replace('**', '<b>', 1)
        while '**' in clean_text:
            clean_text = clean_text.replace('**', '</b>', 1)
            if '**' in clean_text:
                clean_text = clean_text.replace('**', '<b>', 1)

        if stripped.startswith("# "):
            h_text = stripped[2:].strip()
            if "VisionGuard" in h_text or "Table of Contents" in h_text:
                continue
            story.append(Paragraph(h_text, h1_style))
            story.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor('#E2E8F0'), spaceBefore=2, spaceAfter=8))

        elif stripped.startswith("## "):
            h_text = stripped[3:].strip()
            story.append(Paragraph(h_text, h2_style))

        elif stripped.startswith("### "):
            h_text = stripped[4:].strip()
            story.append(Paragraph(h_text, h3_style))

        elif stripped.startswith("- ") or stripped.startswith("* "):
            b_text = clean_text[2:].strip()
            story.append(Paragraph(f"&bull; {b_text}", bullet_style))

        else:
            story.append(Paragraph(clean_text, body_style))

    doc.build(story, canvasmaker=NumberedCanvas)
    print(f"PDF document successfully created: {output_pdf} (Size: {os.path.getsize(output_pdf)} bytes)")

if __name__ == '__main__':
    workspace_dir = r"e:\E\WORKSPACE\work\projects\vision guard remastered"
    guide_file = os.path.join(workspace_dir, "docs", "complete-project-guide.md")
    output_docx = os.path.join(workspace_dir, "docs", "VisionGuard_Complete_Project_Guide.docx")
    output_pdf = os.path.join(workspace_dir, "docs", "VisionGuard_Complete_Project_Guide.pdf")

    if not os.path.exists(guide_file):
        print(f"Error: Guide file {guide_file} does not exist.")
        sys.exit(1)

    generate_docx(guide_file, output_docx)
    generate_pdf(guide_file, output_pdf)
    print("Documentation generation completed successfully!")
