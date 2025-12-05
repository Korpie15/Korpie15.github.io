// ============================================
// MODERN INTERACTIVE PORTFOLIO - JAVASCRIPT
// ============================================

// ============================================
// SMOOTH SCROLLING & NAVBAR
// ============================================

// Navbar scroll effect
window.addEventListener('scroll', () => {
    const navbar = document.getElementById('navbar');
    if (window.scrollY > 50) {
        navbar.classList.add('scrolled');
    } else {
        navbar.classList.remove('scrolled');
    }
});

// Mobile navigation toggle
const navToggle = document.getElementById('navToggle');
const navMenu = document.getElementById('navMenu');

if (navToggle) {
    navToggle.addEventListener('click', () => {
        navMenu.classList.toggle('active');
    });
}

// Close mobile menu when clicking on a link
document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', () => {
        navMenu.classList.remove('active');
    });
});

// Smooth scroll for navigation links
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
            target.scrollIntoView({
                behavior: 'smooth',
                block: 'start'
            });
        }
    });
});

// ============================================
// SCROLL ANIMATIONS
// ============================================

const observerOptions = {
    threshold: 0.1,
    rootMargin: '0px 0px -100px 0px'
};

const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.classList.add('animated');
            
            // Animate skill bars when they come into view
            if (entry.target.classList.contains('skill-bars')) {
                animateSkillBars();
            }
            
            // Animate counters when they come into view
            if (entry.target.querySelector('[data-count]')) {
                animateCounters(entry.target);
            }
        }
    });
}, observerOptions);

// Observe all elements with data-animate attribute
document.querySelectorAll('[data-animate]').forEach(el => {
    observer.observe(el);
});

// ============================================
// ANIMATED COUNTERS
// ============================================

function animateCounters(container) {
    const counters = container.querySelectorAll('[data-count]');
    
    counters.forEach(counter => {
        const target = parseFloat(counter.getAttribute('data-count'));
        const duration = 2000; // 2 seconds
        const increment = target / (duration / 16); // 60fps
        let current = 0;
        
        const updateCounter = () => {
            current += increment;
            if (current < target) {
                counter.textContent = Math.floor(current);
                requestAnimationFrame(updateCounter);
            } else {
                counter.textContent = target;
            }
        };
        
        updateCounter();
    });
}

// Calculate years of experience since June 2022
function calculateYearsExperience() {
    const startDate = new Date(2022, 5, 1); // June 1, 2022 (month is 0-indexed)
    const now = new Date();
    const diffTime = Math.abs(now - startDate);
    const diffYears = diffTime / (1000 * 60 * 60 * 24 * 365.25);
    return diffYears.toFixed(1);
}

// Update years experience on page load
document.addEventListener('DOMContentLoaded', () => {
    const yearsElement = document.getElementById('years-experience');
    const yearsProfessional = document.getElementById('years-professional');
    
    if (yearsElement) {
        const years = calculateYearsExperience();
        yearsElement.textContent = years;
    }
    
    if (yearsProfessional) {
        const years = calculateYearsExperience();
        yearsProfessional.textContent = years;
    }
});

// ============================================
// SKILL BARS ANIMATION
// ============================================

function animateSkillBars() {
    const skillFills = document.querySelectorAll('.skill-fill');
    
    skillFills.forEach(fill => {
        const width = fill.getAttribute('data-width');
        setTimeout(() => {
            fill.style.width = width + '%';
        }, 200);
    });
}

// ============================================
// LIGHTBOX GALLERY
// ============================================

const galleryImages = [
    'images/bae-mechsoc3.jpg',
    'images/mechsoc_group_photo.JPG',
    'images/industry_night.JPG'
];

let currentImageIndex = 0;

function openLightbox(index) {
    currentImageIndex = index;
    const lightbox = document.getElementById('lightbox');
    const lightboxImage = document.getElementById('lightbox-image');
    
    lightboxImage.src = galleryImages[index];
    lightbox.style.display = 'block';
    document.body.style.overflow = 'hidden';
}

function closeLightbox() {
    const lightbox = document.getElementById('lightbox');
    lightbox.style.display = 'none';
    document.body.style.overflow = 'auto';
}

function navigateLightbox(direction) {
    currentImageIndex += direction;
    
    if (currentImageIndex >= galleryImages.length) {
        currentImageIndex = 0;
    } else if (currentImageIndex < 0) {
        currentImageIndex = galleryImages.length - 1;
    }
    
    const lightboxImage = document.getElementById('lightbox-image');
    lightboxImage.src = galleryImages[currentImageIndex];
}

// Close lightbox on escape key
document.addEventListener('keydown', (e) => {
    const lightbox = document.getElementById('lightbox');
    if (e.key === 'Escape' && lightbox.style.display === 'block') {
        closeLightbox();
    }
    
    // Navigate with arrow keys
    if (lightbox.style.display === 'block') {
        if (e.key === 'ArrowLeft') {
            navigateLightbox(-1);
        } else if (e.key === 'ArrowRight') {
            navigateLightbox(1);
        }
    }
});

// ============================================
// SLIDESHOW FUNCTIONALITY
// ============================================

let slideIndex = 1;
let slideTimer;

// Initialize slideshow when page loads
document.addEventListener('DOMContentLoaded', () => {
    showSlides(slideIndex);
    startAutoSlide();
});

// Next/previous controls
function plusSlides(n) {
    clearTimeout(slideTimer);
    showSlides(slideIndex += n);
    startAutoSlide();
}

// Also support changeSlide function name
function changeSlide(n) {
    plusSlides(n);
}

// Thumbnail image controls
function currentSlide(n) {
    clearTimeout(slideTimer);
    showSlides(slideIndex = n);
    startAutoSlide();
}

function showSlides(n) {
    let i;
    let slides = document.getElementsByClassName("slide");
    let dots = document.getElementsByClassName("dot");
    
    if (slides.length === 0) return; // Exit if no slides found
    
    if (n > slides.length) {slideIndex = 1}
    if (n < 1) {slideIndex = slides.length}
    
    for (i = 0; i < slides.length; i++) {
        slides[i].classList.remove("active");
    }
    
    for (i = 0; i < dots.length; i++) {
        dots[i].className = dots[i].className.replace(" active", "");
    }
    
    slides[slideIndex-1].classList.add("active");
    if (dots.length > 0) {
        dots[slideIndex-1].className += " active";
    }
}

// Auto-advance slideshow
function startAutoSlide() {
    slideTimer = setTimeout(function() {
        slideIndex++;
        showSlides(slideIndex);
        startAutoSlide();
    }, 5000); // Change slide every 5 seconds
}

// ============================================
// PROJECT TILES TOGGLE
// ============================================

function toggleProject(element) {
    // Check if user is selecting text
    const selection = window.getSelection();
    if (selection.toString().length > 0) {
        return; // Don't toggle if text is selected
    }
    
    // Prevent toggle if clicking on links
    if (event && event.target.tagName === 'A') {
        return;
    }
    
    element.classList.toggle('expanded');
}

// ============================================
// VIDEO MODAL
// ============================================

function openModal(videoId) {
    const modal = document.getElementById('videoModal');
    const container = document.getElementById('modal-video-container');
    
    let videoEmbed = '';
    
    if (videoId === 'pack-turner-video') {
        videoEmbed = `
            <iframe width="100%" height="500" 
               
                title="Pack Turner In Operation" 
                frameborder="0" 
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" 
                referrerpolicy="strict-origin-when-cross-origin" 
                allowfullscreen>
            </iframe>
        `;
    }
    
    container.innerHTML = videoEmbed;
    modal.style.display = 'block';
    document.body.style.overflow = 'hidden';
}

function closeModal() {
    const modal = document.getElementById('videoModal');
    const container = document.getElementById('modal-video-container');
    
    container.innerHTML = '';
    modal.style.display = 'none';
    document.body.style.overflow = 'auto';
}

// ============================================
// PROJECT MODALS
// ============================================

const projectData = {
    'portfolio': {
        title: 'Professional ePortfolio Website',
        description: `
            <p>This professional ePortfolio website represents a modern approach to web development, combining traditional programming skills with cutting edge AI collaboration tools. The project showcases my ability to effectively leverage Large Language Models (LLMs) and AI-assisted development workflows to create a polished, responsive web presence.</p>
            
            <p>Throughout the development process, I utilised multiple AI platforms including <strong>ChatGPT, Google Gemini, and Claude</strong> to explore different design approaches, troubleshoot issues, and refine the user experience. Each LLM brought unique strengths to the project. From generating initial HTML/CSS structures to optimising responsive layouts and suggesting best practices for web accessibility.</p>
            
            <p>A key aspect of this project was my experience with <strong>GitHub Copilot's agent-based workflow</strong>. Rather than simply accepting code suggestions, I approached the development process as a project manager, assigning specific tasks and roles to AI agents, reviewing their proposed changes, and iteratively refining the output. This workflow involved:</p>
            <ul>
                <li><strong>Task Delegation:</strong> Breaking down complex features into specific, well-defined tasks for AI agents</li>
                <li><strong>Code Review:</strong> Critically evaluating AI-generated code for quality, maintainability, and alignment with project goals</li>
                <li><strong>Iterative Refinement:</strong> Providing feedback and requesting modifications to achieve the desired outcome</li>
                <li><strong>Version Control:</strong> Managing changes through Git to maintain a clear development history</li>
            </ul>
            
            <p>The project also enhanced my skills in <strong>web technologies (HTML5, CSS3, JavaScript)</strong>, <strong>responsive design principles</strong>, <strong>UI/UX considerations</strong>, and <strong>Git version control</strong>. By treating AI as a collaborative tool rather than a replacement for critical thinking, I developed a workflow that maximises productivity while maintaining high code quality and design standards.</p>
            
            <p>This experience has prepared me for the evolving landscape of software development, where the ability to effectively collaborate with AI tools is becoming as important as traditional programming skills. It demonstrates my adaptability, project management capabilities, and understanding of how to leverage emerging technologies to deliver professional results.</p>
            
            <p>I place strong emphasis on attention to detail throughout design and implementation. The site follows a mobile-first approach and has been tested across major mobile browsers (Chrome, Safari, Firefox, Edge) to ensure responsive layouts, readable typography, accessible navigation (ARIA attributes and keyboard support), and correct image handling on small screens.</p>
            
            <p>For users who prefer a paper copy, the site's Print controls (the Print link in the top navigation and the print-friendly banner) automatically expand all project tiles and ensure photos are included when printing. This provides an easy way to produce a complete, print optimised version of the portfolio that preserves expanded content and images for offline review.</p>
            
            <p><strong>Live Site:</strong> <a href="https://korpie15.github.io/" target="_blank">korpie15.github.io</a><br>
            <strong>GitHub:</strong> <a href="https://github.com/Korpie15/Korpie15.github.io" target="_blank">View Repository</a></p>
        `
    },
    'turtlebot': {
        title: 'Turtle Bot Warehousing System',
        description: `
            <p>The Turtlebot warehousing robot autonomis item picking and delivery in warehouses using a scalable system of robots. Initially, a single robot maps the warehouse, creating a static map while avoiding dynamic obstacles like people or forklifts. The system assigns tasks to robots based on proximity and payload capacity, coordinating item retrieval and delivery to a drop-off zone. Using lidar, the robots dynamically avoid obstacles, including each other, to maintain efficiency.</p>
            
            <p>My focus was on the payload delivery system, a 3D-printed mechanism with a servo-driven trap door. Mounted on the top of the robot, it securely carries and dispenses items from the pick-up to the drop-off zone. Controlled by an Arduino Nano that listens for a signal from the Raspberry Pi the turtle bot is running on. By being mounted above the Lidar the system minimises interference with the lidar for smooth operation.</p>
            
            <div style="margin-top: 20px;">
                <iframe width="100%" height="400" 
                    src="https://www.youtube.com/embed/PykMOBxtqDs?si=Vog3GEVmjzvJvmNK" 
                    title="Turtle bot Warehousing System" 
                    frameborder="0" 
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" 
                    allowfullscreen>
                </iframe>
            </div>
            
            <p><strong>GitHub:</strong> <a href="https://github.com/imJohly/warehouse_tasker/tree/Payload" target="_blank">View Repository</a></p>
        `
    },
    'robotics': {
        title: 'Robotics Control Project',
        description: `
            <p>This project involved simulating a robotic system with two robots, one of which required designing both its physical and kinematic models. The system was tasked with performing a pick, place, and sorting operation to organise blocks by colour. This included a GUI, obstacle detection, and a physical emergency stop button that worked in both simulation and on real hardware. A RealSense camera was used for vision, providing both colour and depth data.</p>
            
            <p>Through this project, I gained a deeper understanding of robotics mathematics, including kinematics and singularity errors. This insight connected theory to my practical experience as a control systems engineer, where I had recently encountered similar challenges with Fanuc robots. Learning the theory behind why robot joints cannot align straight, to avoid singularity errors, was particularly valuable as it directly addressed a real-world problem I had faced.</p>
            
            <div style="margin-top: 20px;">
                <iframe width="100%" height="400" 
                    src="https://www.youtube.com/embed/mtV6qu-1_xM?si=5ocI-sWwbQ1oIWb6" 
                    title="Robotic Control Project Video" 
                    frameborder="0" 
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" 
                    allowfullscreen>
                </iframe>
            </div>
        `
    },
    'tetris': {
        title: 'AI Tetris',
        description: `
            <p>In AI in Robotics, my group project was to program an AI model that could play Tetris. We successfully achieved this goal.</p>
            
            <p>The Tetris AI project uses Deep Q-Networks (DQN) and reinforcement learning to optimise gameplay. The AI evaluates the best moves based on board metadata, enabling it to plan for combos like "Tetris clears" while minimising gaps and towers. It generalises well across board sizes, such as a 30x20 grid, despite training exclusively on a standard 10x20 grid. By analysing final states instead of individual moves, the model achieves efficient, adaptable, and high-performing gameplay.</p>
            
            <div style="margin-top: 20px;">
                <iframe width="100%" height="400" 
                    src="https://www.youtube.com/embed/jo5F_d3a7GM" 
                    title="Tetris Project Video" 
                    frameborder="0" 
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" 
                    allowfullscreen>
                </iframe>
            </div>
            
            <p><strong>Live Demo:</strong> <a href="https://topey2x.github.io/TetrisAI/" target="_blank">Play Tetris AI</a><br>
            <strong>GitHub:</strong> <a href="https://github.com/Topey2X/TetrisAI" target="_blank">View Repository</a></p>
        `
    },
    'spot': {
        title: 'SPOT Search and Rescue',
        description: `
            <p>This group project involved leveraging the Boston Dynamics SPOT robot for search-and-rescue operations in challenging and potentially hazardous environments. We developed a ROS1 package to facilitate autonomous exploration and human detection, making the system accessible for anyone to install and use. The onboard video feed from SPOT was integrated with YOLOv3 for human identification, achieving a confidence threshold of 80%. Since the pre-trained human detection model met our needs, no additional model training was required. When a human was detected, a marker was placed on a global map, allowing rescuers to pinpoint their exact locations.</p>
            
            <p>Exploration of the environment utilised a greedy frontier-based algorithm, ensuring complete area coverage. Once SPOT finished exploring, the total number of markers on the map provided the rescue team with a clear overview of all detected individuals and their locations.</p>
            
            <p>This project was also a significant learning experience for me. It marked my first exposure to ROS, Linux, and Git repositories, helping me build confidence in installing and integrating different packages into robotic projects. These new skills have expanded my technical capabilities and prepared me for future projects.</p>
        `
    },
    'thor': {
        title: 'THOR Robotic Build',
        description: `
            <p>Open-source humanoid robot build project for UTSMechSoc to engage members and showcase at open days.</p>
            
            <p>The THOR robot project was undertaken as a society initiative to provide hands-on learning opportunities for members while creating an impressive display piece for university events. This open-source build allowed students to gain practical experience in mechanical assembly, electrical systems, and robotics integration.</p>
            
            <div style="margin-top: 20px; text-align: center;">
                <img src="images/Thor_Robot1.jpeg" alt="THOR Robot" style="max-width: 100%; border-radius: 10px;">
            </div>
        `
    }
};

function openProjectModal(projectId) {
    const modal = document.getElementById('projectModal');
    const content = document.getElementById('project-modal-content');
    const project = projectData[projectId];
    
    if (project) {
        content.innerHTML = `
            <h2>${project.title}</h2>
            <div class="project-details">
                ${project.description}
            </div>
        `;
        modal.style.display = 'block';
        document.body.style.overflow = 'hidden';
    }
}

function closeProjectModal() {
    const modal = document.getElementById('projectModal');
    modal.style.display = 'none';
    document.body.style.overflow = 'auto';
}

// Close modals when clicking outside
window.addEventListener('click', (e) => {
    const videoModal = document.getElementById('videoModal');
    const projectModal = document.getElementById('projectModal');
    const lightbox = document.getElementById('lightbox');
    
    if (e.target === videoModal) {
        closeModal();
    }
    if (e.target === projectModal) {
        closeProjectModal();
    }
    if (e.target === lightbox) {
        closeLightbox();
    }
});

// ============================================
// PARTICLE ANIMATION (Enhanced)
// ============================================

function createParticles() {
    const particlesContainer = document.getElementById('particles');
    if (!particlesContainer) return;
    
    // Create animated gradient circles
    for (let i = 0; i < 3; i++) {
        const circle = document.createElement('div');
        circle.style.position = 'absolute';
        circle.style.borderRadius = '50%';
        circle.style.filter = 'blur(60px)';
        circle.style.opacity = '0.3';
        circle.style.animation = `float ${10 + i * 5}s ease-in-out infinite`;
        
        const size = 200 + i * 100;
        circle.style.width = size + 'px';
        circle.style.height = size + 'px';
        
        const colors = [
            'radial-gradient(circle, rgba(102, 126, 234, 0.8) 0%, transparent 70%)',
            'radial-gradient(circle, rgba(118, 75, 162, 0.8) 0%, transparent 70%)',
            'radial-gradient(circle, rgba(240, 147, 251, 0.8) 0%, transparent 70%)'
        ];
        circle.style.background = colors[i];
        
        circle.style.left = (i * 30) + '%';
        circle.style.top = (i * 20) + '%';
        
        particlesContainer.appendChild(circle);
    }
}

// Add float animation
const style = document.createElement('style');
style.textContent = `
    @keyframes float {
        0%, 100% {
            transform: translate(0, 0) scale(1);
        }
        33% {
            transform: translate(30px, -30px) scale(1.1);
        }
        66% {
            transform: translate(-20px, 20px) scale(0.9);
        }
    }
`;
document.head.appendChild(style);

// ============================================
// INITIALIZE ON PAGE LOAD
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    createParticles();
    
    // Trigger animations for elements already in view
    const elementsInView = document.querySelectorAll('[data-animate]');
    elementsInView.forEach(el => {
        const rect = el.getBoundingClientRect();
        if (rect.top < window.innerHeight) {
            observer.observe(el);
        }
    });
});

// ============================================
// ACTIVE NAVIGATION HIGHLIGHTING
// ============================================

window.addEventListener('scroll', () => {
    const sections = document.querySelectorAll('.section');
    const navLinks = document.querySelectorAll('.nav-link');
    
    let current = '';
    
    sections.forEach(section => {
        const sectionTop = section.offsetTop;
        const sectionHeight = section.clientHeight;
        
        if (window.pageYOffset >= sectionTop - 200) {
            current = section.getAttribute('id');
        }
    });
    
    navLinks.forEach(link => {
        link.classList.remove('active');
        if (link.getAttribute('href') === '#' + current) {
            link.classList.add('active');
        }
    });
});

// ============================================
// TYPING EFFECT FOR HERO SUBTITLE
// ============================================

function typeWriter(element, text, speed = 100) {
    let i = 0;
    element.textContent = '';
    
    function type() {
        if (i < text.length) {
            element.textContent += text.charAt(i);
            i++;
            setTimeout(type, speed);
        }
    }
    
    type();
}

// Start typing effect when page loads
window.addEventListener('load', () => {
    const typingElement = document.querySelector('.typing-text');
    if (typingElement) {
        const text = typingElement.textContent;
        typeWriter(typingElement, text, 100);
    }
});

// ============================================
// PRINT FUNCTION
// ============================================

function printPage() {
    // Trigger print dialog for current page
    window.print();
}

console.log('🚀 Interactive Portfolio Loaded Successfully!');
