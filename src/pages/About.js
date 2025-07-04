import React, { useState } from 'react';
import { Modal, Button } from 'react-bootstrap';
import mem1 from '../assets/mem1.png';
import mem2 from '../assets/mem2.png';
import mem3 from '../assets/mem3.png';
import mem4 from '../assets/mem4.png';
import mem5 from '../assets/mem5.png';
import mem6 from '../assets/mem6.png';


const team = [
  {
    id: 1,
    name: 'Lanru Fu',
    short: 'Lanru',
    img: mem1,
    bio: `Lanru is a current M.S. Applied Analytics candidate at Columbia University. Prior to that, she earned her BS in Mathematics and BA in Economics from UC Irvine (home of the Anteaters!). She is a self-driven data enthusiast and is always willing to learn. Thriving on the challenges of this ever-evolving world, she keeps committed to staying at the forefront of emerging technologies and methodologies in the realm of data analytics and data science. In addition to the academic pursuits, she also values opportunities in translating meaningful insights in real-world scenarios. The SMASH! App represents a fresh and innovative experience for her, and she eagerly embraces the opportunity to leverage her abilities.`,
    email: 'lf2752@columbia.edu',
    linkedin: 'lanru-fu-a55376162'
  },
  {
    id: 2,
    name: 'Wendi Hu',
    short: 'Wendi',
    img: mem2,
    bio: `Wendi is currently pursuing her MSc in Applied Analytics at Columbia University, focusing on honing her skills in Machine Learning, Statistical Modeling, and Econometrics. As a Data Scientist, she brings expertise in these areas, along with a strong aptitude for learning and staying abreast of the latest advancements. She possesses a strong learning ability and is driven by her passion for math and coding. Additionally, in her leisure time, Wendi indulges in her love for photography, capturing captivating moments through her lens.`,
    email: 'wh2521@columbia.edu',
    linkedin: 'wendihu-wendy'
  },
  {
    id: 3,
    name: 'Woon Sup Kim',
    short: 'Woon Sup',
    img: mem3,
    bio: `Woon Sup is a data scientist with a Master's degree from Columbia University. He has a strong background in data science, product management, and engineering and has been working in the industry for over six years. Sports has always been a big part of his life. He regularly competes in boxing, swimming, and recently became a fan of tennis after witnessing Alcaraz’s intense win against Tiafoe at US Open. Woon Sup frequently intersects his data science skills with his interests and participates in various projects.`,
    email: 'wk2371@columbia.edu',
    linkedin: 'woonsup-kim'
  },
  {
    id: 4,
    name: 'Emily Pham',
    short: 'Emily',
    img: mem4,
    bio: `Emily Pham is currently a research assistant at Columbia GSAPP and a data analyst intern at Endear. Prior to her enrollment at Columbia, she studied statistics and gained experience as a data scientist at MGN Microgrid Networks in New York. She is enthusiastic about applying her expertise in data analytics to the field of sports.`,
    email: 'tp2701@columbia.edu',
    linkedin: 'emily-tpham'
  },
  {
    id: 5,
    name: 'Vivian Yin',
    short: 'Vivian',
    img: mem5,
    bio: `Vivian is a passionate data scientist and a current graduate student in Columbia University's Applied Analytics program. She graduated from NYU with a bachelor's degree in Mathematics and Economics and has experience working in both the financial and gaming industries. Vivian is a sports enthusiast. In addition to tennis, she enjoys watching soccer, basketball, and hockey games. She is always eager to apply her data analytics skills to diverse fields.`,
    email: 'vivian.yin@columbia.edu',
    linkedin: 'vivianryin'
  },
  {
    id: 6,
    name: 'Day Yi',
    short: 'Day',
    img: mem6,
    bio: `Day is a lecturer at Columbia University in the Applied Analytics department. He is a passionate sports fan and loves to apply his analytic ideas toward sports scenarios. This SMASH! app was made possible with the help of his core development team and their dedication to devote free time toward side projects.`,
    email: 'dy2365@columbia.edu',
    linkedin: 'dayhyi'
  }
];

function About() {
  const [activeId, setActiveId] = useState(null);
  const handleClose = () => setActiveId(null);

  return (
    <div className="about-page text-center" style={{ paddingTop: '80px' }}>
      <h3 className="text-success mb-3">The Development Team</h3>
      <p className="text-white mb-4">Click on an image to view the member's bio.</p>
      <div className="d-flex justify-content-center flex-wrap">
        {team.map(member => (
          <div key={member.id} className="px-3 mb-4">
            <img
              src={member.img}
              alt={member.short}
              className={`rounded-circle border ${activeId === member.id ? 'border-warning' : 'border-white'}`}
              width={100}
              style={{ cursor: 'pointer' }}
              onClick={() => setActiveId(member.id)}
            />
            <h5 className={activeId === member.id ? 'text-warning' : 'text-white'}>{member.short}</h5>
          </div>
        ))}
      </div>

      {team.map(member => (
        <Modal key={member.id} show={activeId === member.id} onHide={handleClose} centered>
          <Modal.Header closeButton>
            <Modal.Title className="text-warning">{member.name}</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <p style={{ textAlign: 'left' }}>{member.bio}</p>
            <p style={{ textAlign: 'left' }}>
              <a href={`mailto:${member.email}`}>{member.email}</a>
              <br />
              <a href={`https://www.linkedin.com/in/${member.linkedin}`} target="_blank" rel="noreferrer">
                LinkedIn Profile
              </a>
            </p>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={handleClose}>
              Close
            </Button>
          </Modal.Footer>
        </Modal>
      ))}
    </div>
  );
}

export default About;
